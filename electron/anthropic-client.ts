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

const DEFAULT_TIMEOUT_MS = 60_000

export async function invokeAnthropicSdk(
  req: LlmInvokeRequest,
): Promise<LlmInvokeResult> {
  const start = Date.now()
  const client = new Anthropic({
    apiKey: req.apiKey,
    baseURL: normalizeBaseUrl(req.baseUrl),
    timeout: req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxRetries: 2,
  })

  const systemText = buildSystemPrompt(req)
  // Only enable prompt caching on the official Anthropic API — proxies
  // may reject the cache_control field with 403.
  const isOfficialApi = /api\.anthropic\.com/i.test(req.baseUrl)
  const cacheBlock = isOfficialApi
    ? { cache_control: { type: 'ephemeral' as const } }
    : {}

  const system: Anthropic.MessageCreateParams['system'] = systemText
    ? [{ type: 'text' as const, text: systemText, ...cacheBlock }]
    : undefined

  const tools = req.tools && req.tools.length > 0
    ? req.tools.map((t, i, arr) => ({
        name: t.name,
        description: t.description ?? '',
        input_schema: t.input_schema as Anthropic.Messages.Tool['input_schema'],
        ...(i === arr.length - 1 ? cacheBlock : {}),
      }))
    : undefined

  // ── Extended thinking ───────────────────────────────────────────
  //
  // When the caller requests 'medium' or 'high' reasoning effort, we
  // enable Anthropic's extended thinking feature. The SDK returns
  // `{ type: 'thinking', thinking: string }` blocks in the content
  // array alongside regular text blocks. We extract those separately
  // so the renderer can display them in a collapsible section.
  const effort = req.reasoningEffort
  const thinkingEnabled = effort === 'medium' || effort === 'high'
  const thinkingBudget = effort === 'high' ? 32768 : 8192

  // Anthropic requires temperature === 1 when thinking is enabled.
  // We also expand max_tokens to accommodate the thinking budget.
  const effectiveTemperature = thinkingEnabled ? 1 : req.temperature
  const effectiveMaxTokens = thinkingEnabled
    ? Math.min(req.maxTokens + thinkingBudget, 128000)
    : req.maxTokens

  try {
    const response = await client.messages.create({
      model: req.model,
      max_tokens: effectiveMaxTokens,
      temperature: effectiveTemperature,
      ...(system ? { system } : {}),
      messages: req.messages.map(toSdkMessage),
      ...(tools ? { tools } : {}),
      ...(thinkingEnabled
        ? { thinking: { type: 'enabled' as const, budget_tokens: thinkingBudget } }
        : {}),
    })

    const durationMs = Date.now() - start
    const thinkingContent = extractThinkingContent(response.content)
    const assistantMessage = normalizeResponse(response.content)
    const content = assistantMessage
      ? extractText(assistantMessage.content)
      : ''
    const toolCalls = assistantMessage
      ? extractToolCalls(assistantMessage.content)
      : []

    const usage = response.usage
    const usageAny = usage as unknown as Record<string, number>
    const cacheRead = usageAny.cache_read_input_tokens ?? 0
    const cacheCreate = usageAny.cache_creation_input_tokens ?? 0

    return {
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
      ...(thinkingContent ? { thinkingContent } : {}),
    }
  } catch (err) {
    const durationMs = Date.now() - start
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
      (err.name === 'TimeoutError' || err.message.includes('timed out'))
    ) {
      return {
        success: false,
        error: `Request timed out after ${req.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`,
        durationMs,
      }
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs,
    }
  }
}

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
  return { role: msg.role, content: blocks as Anthropic.Messages.ContentBlockParam[] }
}

/**
 * Extract and concatenate all thinking blocks from the response content.
 * Returns `undefined` when no thinking blocks are present (i.e. the model
 * didn't use extended thinking, or it was not requested).
 */
function extractThinkingContent(
  content: Anthropic.Messages.ContentBlock[],
): string | undefined {
  if (!content || content.length === 0) return undefined
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'thinking' && 'thinking' in block) {
      const text = (block as { type: 'thinking'; thinking: string }).thinking
      if (text) parts.push(text)
    }
  }
  return parts.length > 0 ? parts.join('\n\n') : undefined
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

function mapSdkError(err: InstanceType<typeof Anthropic.APIError>): string {
  const detail = err.message ? ` (${err.message.slice(0, 200)})` : ''
  if (err.status === 401) return `Authentication failed — check your API key.${detail}`
  if (err.status === 403) return `Access denied (403).${detail}`
  if (err.status === 429) return 'Rate limited — too many requests. Retrying automatically.'
  if (err.status === 500) return `Anthropic server error.${detail}`
  if (err.status === 529) return 'Anthropic is overloaded — try again in a few minutes.'
  return err.message || `HTTP ${err.status}`
}

function normalizeBaseUrl(s: string): string {
  let url = s.endsWith('/') ? s.slice(0, -1) : s
  if (url.endsWith('/v1')) url = url.slice(0, -3)
  return url
}
