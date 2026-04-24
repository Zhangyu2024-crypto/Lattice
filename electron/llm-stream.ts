// Main-process Anthropic SDK streaming manager.
//
// Streams LLM responses via `client.messages.stream()` and pushes incremental
// deltas to the renderer over IPC (`webContents.send`). The renderer
// subscribes via the preload bridge (`onLlmStreamChunk`, `onLlmStreamEnd`,
// etc.) and reassembles the full response locally.
//
// Only Anthropic is supported for streaming; OpenAI callers continue using the
// one-shot `llm:invoke` path. The final `llm:stream-end` event carries the
// same `LlmInvokeResult` shape as a one-shot call so the renderer's
// orchestrator does not need two code paths for result handling.

import Anthropic from '@anthropic-ai/sdk'
import type {
  LlmInvokeRequest,
  LlmInvokeResult,
  LlmMessage,
  LlmMessageBlock,
  LlmTextBlock,
  LlmToolUseBlock,
  ToolCallRequest,
} from './llm-proxy'

// ── Stream bookkeeping ──────────────────────────────────────────────

interface ActiveStream {
  controller: AbortController
}

const activeStreams = new Map<string, ActiveStream>()

let streamCounter = 0

function generateStreamId(): string {
  streamCounter += 1
  return `stream_${Date.now()}_${streamCounter}`
}

// ── Public API ──────────────────────────────────────────────────────

export type StreamStartResult =
  | { ok: true; streamId: string }
  | { ok: false; error: string }

/**
 * Begin a streaming LLM call. Returns immediately with a `streamId`; the
 * actual network work runs in the background. Incremental events are pushed
 * to `sender` (the renderer's `webContents`):
 *
 *   - `llm:stream-chunk`    { streamId, textDelta }
 *   - `llm:stream-tool-use` { streamId, toolUse: { id, name, input } }
 *   - `llm:stream-end`      { streamId, result: LlmInvokeResult }
 */
export function startStream(
  req: LlmInvokeRequest,
  sender: Electron.WebContents,
): StreamStartResult {
  if (req.provider !== 'anthropic') {
    return { ok: false, error: 'Streaming is only supported for Anthropic provider.' }
  }

  const streamId = generateStreamId()
  const controller = new AbortController()
  activeStreams.set(streamId, { controller })

  // Fire-and-forget — the caller gets the streamId synchronously.
  runStream(req, streamId, controller, sender).catch(() => {
    // `runStream` handles its own errors and always emits `llm:stream-end`;
    // this catch is purely defensive against unhandled-rejection noise.
  })

  return { ok: true, streamId }
}

/**
 * Abort an in-flight stream. Idempotent — calling with an unknown or
 * already-finished streamId is a no-op.
 */
export function abortStream(streamId: string): void {
  const entry = activeStreams.get(streamId)
  if (entry) {
    entry.controller.abort()
    activeStreams.delete(streamId)
  }
}

// ── Internal ────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 120_000

async function runStream(
  req: LlmInvokeRequest,
  streamId: string,
  controller: AbortController,
  sender: Electron.WebContents,
): Promise<void> {
  const start = Date.now()

  try {
    const client = new Anthropic({
      apiKey: req.apiKey,
      baseURL: normalizeBaseUrl(req.baseUrl),
      timeout: req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRetries: 2,
    })

    const systemText = buildSystemPrompt(req)
    const isOfficialApi = /api\.anthropic\.com/i.test(req.baseUrl)
    const cacheBlock = isOfficialApi
      ? { cache_control: { type: 'ephemeral' as const } }
      : {}

    const system: Anthropic.MessageCreateParams['system'] = systemText
      ? [{ type: 'text' as const, text: systemText, ...cacheBlock }]
      : undefined

    const tools =
      req.tools && req.tools.length > 0
        ? req.tools.map((t, i, arr) => ({
            name: t.name,
            description: t.description ?? '',
            input_schema:
              t.input_schema as Anthropic.Messages.Tool['input_schema'],
            ...(i === arr.length - 1 ? cacheBlock : {}),
          }))
        : undefined

    const stream = client.messages.stream(
      {
        model: req.model,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
        ...(system ? { system } : {}),
        messages: req.messages.map(toSdkMessage),
        ...(tools ? { tools } : {}),
      },
      { signal: controller.signal },
    )

    // ── Wire up incremental events ──────────────────────────────

    stream.on('text', (textDelta) => {
      if (!sender.isDestroyed()) {
        sender.send('llm:stream-chunk', { streamId, textDelta })
      }
    })

    stream.on('contentBlock', (block) => {
      if (block.type === 'tool_use' && !sender.isDestroyed()) {
        sender.send('llm:stream-tool-use', {
          streamId,
          toolUse: {
            id: block.id,
            name: block.name,
            input:
              block.input && typeof block.input === 'object'
                ? (block.input as Record<string, unknown>)
                : {},
          },
        })
      }
    })

    // Wait for the stream to finish and build the final result.
    const finalMessage = await stream.finalMessage()
    const durationMs = Date.now() - start

    const assistantMessage = normalizeResponse(finalMessage.content)
    const content = assistantMessage
      ? extractText(assistantMessage.content)
      : ''
    const toolCalls = assistantMessage
      ? extractToolCalls(assistantMessage.content)
      : []

    const usage = finalMessage.usage
    const usageAny = usage as unknown as Record<string, number>
    const cacheRead = usageAny.cache_read_input_tokens ?? 0
    const cacheCreate = usageAny.cache_creation_input_tokens ?? 0

    const result: LlmInvokeResult = {
      success: true,
      content,
      usage: {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        ...(cacheRead > 0 ? { cacheReadTokens: cacheRead } : {}),
        ...(cacheCreate > 0 ? { cacheCreateTokens: cacheCreate } : {}),
      },
      durationMs,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      ...(assistantMessage ? { messages: [assistantMessage] } : {}),
    }

    if (!sender.isDestroyed()) {
      sender.send('llm:stream-end', { streamId, result })
    }
  } catch (err) {
    const durationMs = Date.now() - start
    const result = toStreamError(err, durationMs)

    if (!sender.isDestroyed()) {
      sender.send('llm:stream-end', { streamId, result })
    }
  } finally {
    activeStreams.delete(streamId)
  }
}

// ── Helpers (duplicated from anthropic-client.ts) ───────────────────
//
// These are private in the sibling module. Duplicating the small helpers
// here keeps the two files decoupled and avoids a refactor that would
// touch the one-shot path.

function buildSystemPrompt(req: LlmInvokeRequest): string | undefined {
  const blocks = req.contextBlocks
  if (!blocks || blocks.length === 0) return req.systemPrompt
  const parts: string[] = []
  if (req.systemPrompt && req.systemPrompt.length > 0) {
    parts.push(req.systemPrompt)
  }
  for (const block of blocks) {
    parts.push(`--- mention ${block.refKey} ---\n${block.body}`)
  }
  return parts.join('\n\n')
}

function toSdkMessage(
  msg: LlmMessage,
): Anthropic.MessageCreateParams['messages'][number] {
  if (typeof msg.content === 'string') {
    return { role: msg.role, content: msg.content }
  }
  const blocks: Anthropic.MessageCreateParams['messages'][number]['content'] =
    (msg.content as LlmMessageBlock[]).map((block) => {
      if (block.type === 'text') {
        return { type: 'text' as const, text: (block as LlmTextBlock).text }
      }
      if (block.type === 'tool_use') {
        const tu = block as LlmToolUseBlock
        return {
          type: 'tool_use' as const,
          id: tu.id,
          name: tu.name,
          input: tu.input,
        }
      }
      if (block.type === 'tool_result') {
        const tr = block as { tool_use_id: string; content: string }
        return {
          type: 'tool_result' as const,
          tool_use_id: tr.tool_use_id,
          content: tr.content,
        }
      }
      if (block.type === 'image') {
        const img = block as {
          source: { type: string; media_type: string; data: string }
        }
        return {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: img.source
              .media_type as Anthropic.Messages.Base64ImageSource['media_type'],
            data: img.source.data,
          },
        }
      }
      return { type: 'text' as const, text: '' }
    })
  return {
    role: msg.role,
    content: blocks as Anthropic.Messages.ContentBlockParam[],
  }
}

function normalizeResponse(
  content: Anthropic.Messages.ContentBlock[],
): LlmMessage | null {
  if (!content || content.length === 0) return null
  const blocks: LlmMessageBlock[] = []
  for (const block of content) {
    if (block.type === 'text') {
      blocks.push({ type: 'text', text: block.text })
    } else if (block.type === 'tool_use') {
      blocks.push({
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input:
          block.input && typeof block.input === 'object'
            ? (block.input as Record<string, unknown>)
            : {},
      })
    }
  }
  if (blocks.length === 0) return null
  const collapsed = blocks.every((b) => b.type === 'text')
    ? blocks.map((b) => (b as LlmTextBlock).text).join('')
    : blocks
  return { role: 'assistant', content: collapsed }
}

function extractText(content: string | LlmMessageBlock[]): string {
  if (typeof content === 'string') return content
  return content
    .filter((b): b is LlmTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
}

function extractToolCalls(
  content: string | LlmMessageBlock[],
): ToolCallRequest[] {
  if (typeof content === 'string') return []
  return content
    .filter((b): b is LlmToolUseBlock => b.type === 'tool_use')
    .map((b) => ({ id: b.id, name: b.name, input: b.input }))
}

function toStreamError(err: unknown, durationMs: number): LlmInvokeResult {
  if (err instanceof Anthropic.APIError) {
    return {
      success: false,
      error: mapSdkError(err),
      status: err.status,
      durationMs,
    }
  }
  if (
    err instanceof Error &&
    (err.name === 'AbortError' ||
      err.name === 'TimeoutError' ||
      err.message.includes('timed out') ||
      err.message.includes('aborted'))
  ) {
    return {
      success: false,
      error: 'Stream aborted',
      durationMs,
    }
  }
  return {
    success: false,
    error: err instanceof Error ? err.message : String(err),
    durationMs,
  }
}

function mapSdkError(err: InstanceType<typeof Anthropic.APIError>): string {
  if (err.status === 401) return 'Authentication failed — check your API key.'
  if (err.status === 403)
    return 'Access denied — your API key may lack permissions.'
  if (err.status === 429)
    return 'Rate limited — too many requests. Retrying automatically.'
  if (err.status === 500) return 'Anthropic server error — try again shortly.'
  if (err.status === 529)
    return 'Anthropic is overloaded — try again in a few minutes.'
  return err.message || `HTTP ${err.status}`
}

function normalizeBaseUrl(s: string): string {
  let url = s.endsWith('/') ? s.slice(0, -1) : s
  if (url.endsWith('/v1')) url = url.slice(0, -3)
  return url
}
