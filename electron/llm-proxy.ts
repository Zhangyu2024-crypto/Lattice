// Main-process LLM HTTP client.
//
// Lives in the Electron main process so HTTPS calls to `api.anthropic.com` /
// `api.openai.com` bypass the renderer CSP (`connect-src 'self'
// ws://localhost:* http://localhost:*` in index.html). Uses Node 18+ global
// `fetch`, which is available in Electron 33.
//
// Normal provider API keys still flow through the renderer from the user's
// llm-config-store. Lattice blog login is different: the renderer only sends
// a stable placeholder, and the main process resolves the real gateway token
// from Electron safeStorage before dispatching the HTTPS request.

import { resolveLatticeApiKeyForRequest } from './lattice-auth-store'
import {
  buildLatticeTraceContext,
  latticeTraceHeaders,
} from './lattice-trace'

export type LlmProviderType = 'anthropic' | 'openai' | 'openai-compatible'

/**
 * One resolved @-mention context block as serialized by the renderer. The
 * main process treats `body` as opaque and splices it into the system prompt
 * verbatim; trimming / redaction / token accounting all happen upstream
 * (see `src/lib/llm-chat.ts`).
 */
export interface LlmContextBlock {
  /** Opaque label used for the block header; typically the mention anchor. */
  refKey: string
  /** Already-trimmed block body. */
  body: string
  /** Renderer-side estimate, logged but not authoritative here. */
  tokenEstimate: number
}

/**
 * Provider-neutral tool input schema. Matches Anthropic's native shape;
 * {@link toOpenAiTools} maps it to OpenAI's nested `function.parameters`
 * form on the wire so the renderer only has to carry one schema.
 */
interface ToolInputSchema {
  type: 'object'
  properties: Record<string, { type: string; description?: string }>
  required?: string[]
}

export interface LlmTextBlock {
  type: 'text'
  text: string
}

export interface LlmToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

interface LlmToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string
}

interface LlmImageBlock {
  type: 'image'
  source: {
    type: 'base64'
    media_type: string
    data: string
  }
}

export type LlmMessageBlock =
  | LlmTextBlock
  | LlmImageBlock
  | LlmToolUseBlock
  | LlmToolResultBlock

export interface LlmMessage {
  role: 'user' | 'assistant'
  content: string | LlmMessageBlock[]
}

interface LlmToolSpec {
  name: string
  description: string
  input_schema: ToolInputSchema
}

type OpenAiResponseInputItem = Record<string, unknown>

interface OpenAiResponseOutputText {
  type?: string
  text?: string
  refusal?: string
}

interface OpenAiResponseOutputItem {
  type?: string
  role?: string
  content?: OpenAiResponseOutputText[]
  call_id?: string
  name?: string
  arguments?: string
}

export interface ToolCallRequest {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface LlmInvokeRequest {
  provider: LlmProviderType
  apiKey: string
  baseUrl: string
  model: string
  systemPrompt?: string
  messages: LlmMessage[]
  maxTokens: number
  temperature: number
  timeoutMs?: number
  /**
   * Composer mode. Reserved for future provider-side routing (e.g. swapping
   * in tool schemas for 'agent' but not 'dialog'). Today both branches use
   * the same HTTP flow; the field exists so provider-specific code paths
   * can fork without another IPC migration.
   */
  mode?: 'dialog' | 'agent'
  /** Ordered list of mention context blocks to prepend to the system prompt. */
  contextBlocks?: LlmContextBlock[]
  /** Tool schemas exposed to the model this turn. */
  tools?: LlmToolSpec[]
  /** Optional audit metadata supplied by the renderer. Never forwarded to
   *  model providers; main-process audit logging consumes it only. */
  audit?: {
    source?: string
    sessionId?: string | null
    taskId?: string
    stepId?: string
    workspaceRoot?: string | null
    metadata?: Record<string, unknown>
  }
  /**
   * Extended thinking effort level. When 'medium' or 'high', the Anthropic
   * SDK client enables the `thinking` parameter so the model can use
   * chain-of-thought reasoning before responding. 'low' or absent means
   * no thinking is requested.
   */
  reasoningEffort?: 'low' | 'medium' | 'high'
  traceId?: string
  module?: 'agent' | 'creator' | 'latex' | 'workspace' | 'compute' | 'research' | 'library'
  operation?: string
  sessionId?: string | null
  artifactId?: string | null
  workspaceIdHash?: string | null
  consentVersion?: string | null
}

export type LlmInvokeResult =
  | {
      success: true
      content: string
      usage: {
        inputTokens: number
        outputTokens: number
        cacheReadTokens?: number
        cacheCreateTokens?: number
      }
      durationMs: number
      /** Normalised tool-use requests extracted from the provider response. */
      toolCalls?: ToolCallRequest[]
      /** Assistant message as we received it, in provider-neutral shape, so
       *  the renderer's orchestrator can splice it back into the messages
       *  array on the next iteration. */
      messages?: LlmMessage[]
      /** Concatenated thinking blocks from an extended-thinking response.
       *  Only present when `reasoningEffort` was 'medium' or 'high' and the
       *  model actually produced thinking content. */
      thinkingContent?: string
    }
  | {
      success: false
      error: string
      status?: number
      durationMs: number
    }

export interface LlmTestConnectionRequest {
  provider: LlmProviderType
  apiKey: string
  baseUrl: string
  timeoutMs?: number
  traceId?: string
  module?: 'agent' | 'creator' | 'latex' | 'workspace' | 'compute' | 'research' | 'library'
  operation?: string
  sessionId?: string | null
  artifactId?: string | null
  workspaceIdHash?: string | null
  consentVersion?: string | null
}

export type LlmTestConnectionResult =
  | {
      success: true
      durationMs: number
      modelCount?: number
    }
  | {
      success: false
      error: string
      status?: number
      durationMs: number
    }

/**
 * One model entry as reported by the provider's `GET /v1/models` endpoint,
 * normalised across Anthropic / OpenAI / OpenAI-compatible shapes. Only `id`
 * is guaranteed — the other fields are best-effort and renderers must treat
 * their absence as "unknown" rather than falling back to silly defaults.
 */
export interface LlmListedModel {
  id: string
  displayName?: string
  createdAt?: number
}

export interface LlmListModelsRequest {
  provider: LlmProviderType
  apiKey: string
  baseUrl: string
  timeoutMs?: number
  traceId?: string
  module?: 'agent' | 'creator' | 'latex' | 'workspace' | 'compute' | 'research' | 'library'
  operation?: string
  sessionId?: string | null
  artifactId?: string | null
  workspaceIdHash?: string | null
  consentVersion?: string | null
}

export type LlmListModelsResult =
  | {
      success: true
      durationMs: number
      models: LlmListedModel[]
    }
  | {
      success: false
      error: string
      status?: number
      durationMs: number
    }

const DEFAULT_TIMEOUT_MS = 60_000
const TEST_TIMEOUT_MS = 10_000
const LIST_MODELS_TIMEOUT_MS = 15_000

/**
 * Assemble the final system prompt by appending mention context blocks to
 * the caller-supplied prompt text. Each block is introduced by a stable
 * marker (`--- mention <refKey> ---`) so the model can reason about block
 * boundaries; blocks are separated by a blank line for readability in both
 * Anthropic's `system` field and OpenAI's `system` role message.
 *
 * When no context blocks are present the original prompt is returned
 * verbatim (including `undefined`) so the call sites can still pass through
 * to the provider without inventing a non-empty prompt.
 */
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

export async function invoke(req: LlmInvokeRequest): Promise<LlmInvokeResult> {
  if (req.provider === 'anthropic') {
    // SDK for official API; raw fetch for proxies (claw-d, etc.) that may
    // reject SDK-specific headers or body fields.
    if (/api\.anthropic\.com/i.test(req.baseUrl)) {
      const { invokeAnthropicSdk } = await import('./anthropic-client')
      return invokeAnthropicSdk(req)
    }
    return invokeAnthropic(req)
  }
  if (req.provider === 'openai' || req.provider === 'openai-compatible') {
    return invokeOpenAI(req)
  }
  return {
    success: false,
    error: `Unsupported provider: ${String(req.provider)}`,
    durationMs: 0,
  }
}

async function invokeAnthropic(req: LlmInvokeRequest): Promise<LlmInvokeResult> {
  const start = Date.now()
  let apiKey: string
  try {
    apiKey = await resolveLatticeApiKeyForRequest(req.apiKey, req.baseUrl)
  } catch (err) {
    return toError(err, Date.now() - start)
  }
  const url = `${stripTrailingSlash(req.baseUrl)}/v1/messages`
  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens,
    temperature: req.temperature,
    system: buildSystemPrompt(req),
    messages: req.messages.map(toAnthropicMessage),
  }
  if (req.tools && req.tools.length > 0) {
    // Anthropic accepts our schema shape verbatim (name / description /
    // input_schema), so no mapping needed here.
    body.tools = req.tools
  }
  try {
    const traceHeaders = latticeTraceHeaders(buildLatticeTraceContext(req))
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        ...traceHeaders,
      },
      body: JSON.stringify(body),
      timeoutMs: req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    })
    const durationMs = Date.now() - start
    if (!res.ok) {
      return {
        success: false,
        error: mapHttpStatusToMessage(res.status, await safeText(res)),
        status: res.status,
        durationMs,
      }
    }
    const json = (await res.json()) as {
      content?: Array<{
        type: string
        text?: string
        id?: string
        name?: string
        input?: Record<string, unknown>
      }>
      usage?: { input_tokens?: number; output_tokens?: number }
    }
    const assistantMessage = normalizeAnthropicAssistantMessage(json.content)
    const content = assistantMessage
      ? extractTextFromContent(assistantMessage.content)
      : ''
    const toolCalls = assistantMessage
      ? extractToolCalls(assistantMessage.content)
      : []
    return {
      success: true,
      content,
      usage: {
        inputTokens: json.usage?.input_tokens ?? 0,
        outputTokens: json.usage?.output_tokens ?? 0,
      },
      durationMs,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      ...(assistantMessage ? { messages: [assistantMessage] } : {}),
    }
  } catch (err) {
    return toError(err, Date.now() - start)
  }
}

async function invokeOpenAI(req: LlmInvokeRequest): Promise<LlmInvokeResult> {
  const start = Date.now()
  let apiKey: string
  try {
    apiKey = await resolveLatticeApiKeyForRequest(req.apiKey, req.baseUrl)
  } catch (err) {
    return toError(err, Date.now() - start)
  }
  const url = `${openAiApiRoot(req.baseUrl)}/responses`
  const systemPrompt = buildSystemPrompt(req)
  const body: Record<string, unknown> = {
    model: req.model,
    input: toOpenAiResponseInput(req.messages),
    max_output_tokens: req.maxTokens,
    temperature: req.temperature,
  }
  if (systemPrompt) {
    body.instructions = systemPrompt
  }
  if (req.tools && req.tools.length > 0) {
    body.tools = toOpenAiResponseTools(req.tools)
    body.tool_choice = 'auto'
  }
  try {
    const traceHeaders = latticeTraceHeaders(buildLatticeTraceContext(req))
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
        ...traceHeaders,
      },
      body: JSON.stringify(body),
      timeoutMs: req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    })
    const durationMs = Date.now() - start
    if (!res.ok) {
      return {
        success: false,
        error: mapHttpStatusToMessage(res.status, await safeText(res)),
        status: res.status,
        durationMs,
      }
    }
    const json = (await res.json()) as {
      output_text?: string
      output?: OpenAiResponseOutputItem[]
      usage?: {
        prompt_tokens?: number
        completion_tokens?: number
        input_tokens?: number
        output_tokens?: number
      }
    }
    const assistantMessage = normalizeOpenAiResponseAssistantMessage(json.output)
    const content = assistantMessage
      ? extractTextFromContent(assistantMessage.content)
      : typeof json.output_text === 'string'
        ? json.output_text
        : ''
    const toolCalls = assistantMessage
      ? extractToolCalls(assistantMessage.content)
      : []
    return {
      success: true,
      content,
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? json.usage?.input_tokens ?? 0,
        outputTokens:
          json.usage?.completion_tokens ?? json.usage?.output_tokens ?? 0,
      },
      durationMs,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      ...(assistantMessage ? { messages: [assistantMessage] } : {}),
    }
  } catch (err) {
    return toError(err, Date.now() - start)
  }
}

// Lightweight API-key validity probe. Hits the provider's `GET /v1/models`
// endpoint, which all three supported provider types expose. This is free
// (unlike a chat completion) and exercises the same auth path as the real
// `invoke()`, so any auth failure surfaces here.
export async function testConnection(
  req: LlmTestConnectionRequest,
): Promise<LlmTestConnectionResult> {
  const start = Date.now()
  if (!req.apiKey || !req.apiKey.trim()) {
    return {
      success: false,
      error: 'API key is empty',
      durationMs: 0,
    }
  }
  if (!req.baseUrl || !req.baseUrl.trim()) {
    return {
      success: false,
      error: 'Base URL is empty',
      durationMs: 0,
    }
  }
  let apiKey: string
  try {
    apiKey = await resolveLatticeApiKeyForRequest(req.apiKey, req.baseUrl)
  } catch (err) {
    return toTestError(err, Date.now() - start)
  }

  const url =
    req.provider === 'anthropic'
      ? `${stripTrailingSlash(req.baseUrl)}/v1/models`
      : `${openAiApiRoot(req.baseUrl)}/models`
  const headers: Record<string, string> =
    req.provider === 'anthropic'
      ? {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          ...latticeTraceHeaders(buildLatticeTraceContext(req)),
        }
      : {
          authorization: `Bearer ${apiKey}`,
          ...latticeTraceHeaders(buildLatticeTraceContext(req)),
        }

  try {
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers,
      timeoutMs: req.timeoutMs ?? TEST_TIMEOUT_MS,
    })
    const durationMs = Date.now() - start
    if (!res.ok) {
      return {
        success: false,
        error: mapHttpStatusToMessage(res.status, await safeText(res)),
        status: res.status,
        durationMs,
      }
    }
    const modelCount = await extractModelCount(res)
    return { success: true, durationMs, modelCount }
  } catch (err) {
    return toTestError(err, Date.now() - start)
  }
}

async function extractModelCount(res: Response): Promise<number | undefined> {
  try {
    const json = (await res.json()) as {
      data?: unknown[]
      models?: unknown[]
    }
    if (Array.isArray(json.data)) return json.data.length
    if (Array.isArray(json.models)) return json.models.length
    return undefined
  } catch {
    return undefined
  }
}

/**
 * Fetch and parse the provider's model catalogue. Shares the same auth path
 * as {@link testConnection} (hits `GET /v1/models`), but returns the
 * structured list instead of just a count so the renderer can populate the
 * provider's `models[]` without asking the user to type ids by hand.
 *
 * Parser is liberal:
 *   - OpenAI-shaped responses: `{ data: [{ id, created?, ... }] }`
 *   - Anthropic-shaped responses: `{ data: [{ id, display_name?, created_at? }] }`
 *   - Ollama-style fallback (not wired today, kept for future): `{ models: [{ name }] }`
 * Any entry missing a usable string id is skipped rather than failing the
 * whole call — some proxies mix valid rows with noise.
 */
export async function listModels(
  req: LlmListModelsRequest,
): Promise<LlmListModelsResult> {
  const start = Date.now()
  if (!req.apiKey || !req.apiKey.trim()) {
    return { success: false, error: 'API key is empty', durationMs: 0 }
  }
  if (!req.baseUrl || !req.baseUrl.trim()) {
    return { success: false, error: 'Base URL is empty', durationMs: 0 }
  }
  let apiKey: string
  try {
    apiKey = await resolveLatticeApiKeyForRequest(req.apiKey, req.baseUrl)
  } catch (err) {
    return toListModelsError(err, Date.now() - start)
  }

  const url =
    req.provider === 'anthropic'
      ? `${stripTrailingSlash(req.baseUrl)}/v1/models`
      : `${openAiApiRoot(req.baseUrl)}/models`
  const headers: Record<string, string> =
    req.provider === 'anthropic'
      ? {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          ...latticeTraceHeaders(buildLatticeTraceContext(req)),
        }
      : {
          authorization: `Bearer ${apiKey}`,
          ...latticeTraceHeaders(buildLatticeTraceContext(req)),
        }

  try {
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers,
      timeoutMs: req.timeoutMs ?? LIST_MODELS_TIMEOUT_MS,
    })
    const durationMs = Date.now() - start
    if (!res.ok) {
      return {
        success: false,
        error: mapHttpStatusToMessage(res.status, await safeText(res)),
        status: res.status,
        durationMs,
      }
    }
    const models = await parseModelList(res)
    return { success: true, durationMs, models }
  } catch (err) {
    return toListModelsError(err, Date.now() - start)
  }
}

async function parseModelList(res: Response): Promise<LlmListedModel[]> {
  let json: unknown
  try {
    json = await res.json()
  } catch {
    return []
  }
  if (!json || typeof json !== 'object') return []
  const root = json as { data?: unknown; models?: unknown }
  const entries = Array.isArray(root.data)
    ? root.data
    : Array.isArray(root.models)
      ? root.models
      : []

  const out: LlmListedModel[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as {
      id?: unknown
      name?: unknown
      display_name?: unknown
      created?: unknown
      created_at?: unknown
    }
    const idSource = typeof row.id === 'string' ? row.id : row.name
    if (typeof idSource !== 'string') continue
    const id = idSource.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)

    const displayRaw =
      typeof row.display_name === 'string' ? row.display_name : undefined
    const displayName = displayRaw && displayRaw.trim() ? displayRaw.trim() : undefined

    let createdAt: number | undefined
    if (typeof row.created === 'number' && Number.isFinite(row.created)) {
      createdAt = row.created
    } else if (typeof row.created_at === 'string') {
      const ms = Date.parse(row.created_at)
      if (Number.isFinite(ms)) createdAt = Math.floor(ms / 1000)
    }

    out.push({ id, displayName, createdAt })
  }
  return out
}

function toListModelsError(
  err: unknown,
  durationMs: number,
): LlmListModelsResult {
  if (err && typeof err === 'object' && 'name' in err) {
    const name = (err as { name?: string }).name
    if (name === 'AbortError') {
      return { success: false, error: 'Request timed out', durationMs }
    }
  }
  const message = err instanceof Error ? err.message : String(err)
  return {
    success: false,
    error: `Network error: ${message}`,
    durationMs,
  }
}

function toTestError(
  err: unknown,
  durationMs: number,
): LlmTestConnectionResult {
  if (err && typeof err === 'object' && 'name' in err) {
    const name = (err as { name?: string }).name
    if (name === 'AbortError') {
      return { success: false, error: 'Request timed out', durationMs }
    }
  }
  const message = err instanceof Error ? err.message : String(err)
  return {
    success: false,
    error: `Network error: ${message}`,
    durationMs,
  }
}

interface FetchOptions {
  method: string
  headers: Record<string, string>
  body?: string
  timeoutMs: number
}

/** Fetch with a timeout tagged as `TimeoutError`. Passing an explicit
 *  `DOMException` reason to `controller.abort()` is load-bearing — calling
 *  `abort()` with no argument makes undici surface the error as a generic
 *  `DOMException('signal is aborted without reason')`, which used to leak
 *  all the way to the user's toast ("signal is aborted without reason
 *  在使用 ai build structure 遇到的问题"). With a concrete reason the
 *  consumer-side `toError` can reliably label it as a timeout. */
async function fetchWithTimeout(
  url: string,
  opts: FetchOptions,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException(
          `Request timed out after ${opts.timeoutMs}ms`,
          'TimeoutError',
        ),
      ),
    opts.timeoutMs,
  )
  try {
    return await fetch(url, {
      method: opts.method,
      headers: opts.headers,
      body: opts.body,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

// ── Tool-use message translation ───────────────────────────────────────────
//
// The renderer holds messages in a provider-neutral shape (string content,
// or an array of `text | tool_use | tool_result` blocks). Each provider has
// its own wire format; these helpers translate one direction per call.

function toAnthropicMessage(message: LlmMessage): Record<string, unknown> {
  if (typeof message.content === 'string') {
    return { role: message.role, content: message.content }
  }
  return {
    role: message.role,
    content: message.content.map((block) => {
      if (block.type === 'text') return { type: 'text', text: block.text }
      if (block.type === 'image') {
        return {
          type: 'image',
          source: {
            type: 'base64',
            media_type: block.source.media_type,
            data: block.source.data,
          },
        }
      }
      if (block.type === 'tool_use') {
        return {
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input,
        }
      }
      return {
        type: 'tool_result',
        tool_use_id: block.tool_use_id,
        content: block.content,
      }
    }),
  }
}

/**
 * Map our neutral message format to OpenAI's Responses API input format.
 * `tool_use` blocks expand to top-level `function_call` input items, and
 * `tool_result` blocks expand to matching top-level `function_call_output`
 * items. The renderer remains provider-neutral and never has to know about
 * Responses item wiring.
 */
function toOpenAiResponseInput(
  messages: LlmMessage[],
): OpenAiResponseInputItem[] {
  const out: OpenAiResponseInputItem[] = []
  for (const message of messages) {
    if (typeof message.content === 'string') {
      out.push(openAiResponseMessage(message.role, message.content))
      continue
    }

    const hasImages = message.content.some((b) => b.type === 'image')
    const textParts = message.content
      .filter((block): block is LlmTextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
    // OpenAI Responses vision: content is an input_text/input_image list.
    if (hasImages && message.role === 'user') {
      const parts: Array<Record<string, unknown>> = []
      for (const block of message.content) {
        if (block.type === 'text') {
          parts.push({ type: 'input_text', text: block.text })
        } else if (block.type === 'image') {
          parts.push({
            type: 'input_image',
            image_url: `data:${block.source.media_type};base64,${block.source.data}`,
            detail: 'auto',
          })
        }
      }
      out.push({ type: 'message', role: 'user', content: parts })
      continue
    }
    const toolUses = message.content.filter(
      (block): block is LlmToolUseBlock => block.type === 'tool_use',
    )
    const toolResults = message.content.filter(
      (block): block is LlmToolResultBlock => block.type === 'tool_result',
    )

    if (message.role === 'assistant') {
      if (textParts.length > 0) {
        out.push(openAiResponseMessage('assistant', textParts))
      }
      for (const block of toolUses) {
        out.push({
          type: 'function_call',
          call_id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input ?? {}),
          status: 'completed',
        })
      }
      continue
    }

    // user role: text first (if any), then one function output per result.
    if (textParts.length > 0) {
      out.push(openAiResponseMessage('user', textParts))
    }
    for (const block of toolResults) {
      out.push({
        type: 'function_call_output',
        call_id: block.tool_use_id,
        output: block.content,
      })
    }
  }
  return out
}

function openAiResponseMessage(
  role: LlmMessage['role'],
  text: string,
): OpenAiResponseInputItem {
  if (role === 'assistant') {
    return {
      type: 'message',
      role,
      status: 'completed',
      content: [{ type: 'output_text', text, annotations: [] }],
    }
  }
  return {
    type: 'message',
    role,
    content: [{ type: 'input_text', text }],
  }
}

function toOpenAiResponseTools(
  tools: LlmToolSpec[],
): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema,
  }))
}

function normalizeAnthropicAssistantMessage(
  content:
    | Array<{
        type: string
        text?: string
        id?: string
        name?: string
        input?: Record<string, unknown>
      }>
    | undefined,
): LlmMessage | null {
  if (!content || content.length === 0) return null
  const blocks: LlmMessageBlock[] = []
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      blocks.push({ type: 'text', text: block.text })
    } else if (
      block.type === 'tool_use' &&
      typeof block.id === 'string' &&
      typeof block.name === 'string'
    ) {
      blocks.push({
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input:
          block.input && typeof block.input === 'object' ? block.input : {},
      })
    }
  }
  if (blocks.length === 0) return null
  return { role: 'assistant', content: collapseMessageContent(blocks) }
}

function normalizeOpenAiResponseAssistantMessage(
  output: OpenAiResponseOutputItem[] | undefined,
): LlmMessage | null {
  if (!output || output.length === 0) return null
  const blocks: LlmMessageBlock[] = []
  for (const item of output) {
    if (item.type === 'message' && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (part.type === 'output_text' && typeof part.text === 'string') {
          blocks.push({ type: 'text', text: part.text })
        } else if (
          part.type === 'refusal' &&
          typeof part.refusal === 'string'
        ) {
          blocks.push({ type: 'text', text: part.refusal })
        }
      }
      continue
    }
    if (
      item.type === 'function_call' &&
      typeof item.call_id === 'string' &&
      typeof item.name === 'string'
    ) {
      blocks.push({
        type: 'tool_use',
        id: item.call_id,
        name: item.name,
        input: parseJsonObject(item.arguments),
      })
    }
  }
  if (blocks.length === 0) return null
  return { role: 'assistant', content: collapseMessageContent(blocks) }
}

/** Keep simple text-only messages as plain strings; only fall back to the
 *  block array when at least one non-text block is present. Minimises wire
 *  divergence for the common case. */
function collapseMessageContent(
  blocks: LlmMessageBlock[],
): string | LlmMessageBlock[] {
  return blocks.every((block) => block.type === 'text')
    ? blocks.map((block) => (block as LlmTextBlock).text).join('')
    : blocks
}

function extractTextFromContent(
  content: string | LlmMessageBlock[],
): string {
  if (typeof content === 'string') return content
  return content
    .filter((block): block is LlmTextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

function extractToolCalls(
  content: string | LlmMessageBlock[],
): ToolCallRequest[] {
  if (typeof content === 'string') return []
  return content
    .filter((block): block is LlmToolUseBlock => block.type === 'tool_use')
    .map((block) => ({
      id: block.id,
      name: block.name,
      input: block.input,
    }))
}

function parseJsonObject(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { value: parsed }
  } catch {
    // OpenAI sometimes returns a raw (non-JSON) arguments string if the
    // model mis-formats the call. Preserve it under `_raw` so the tool can
    // at least report a coherent error back through tool_result.
    return { _raw: raw }
  }
}

function mapHttpStatusToMessage(status: number, bodyExcerpt: string): string {
  const excerpt = bodyExcerpt.slice(0, 200).trim()
  const suffix = excerpt ? ` — ${excerpt}` : ''
  if (status === 401 || status === 403) return `Authentication failed${suffix}`
  if (status === 429) return `Rate limited${suffix}`
  if (status >= 500) return `Provider error ${status}${suffix}`
  if (status === 400) return `Bad request${suffix}`
  return `HTTP ${status}${suffix}`
}

function toError(err: unknown, durationMs: number): LlmInvokeResult {
  const message = err instanceof Error ? err.message : String(err)
  if (err && typeof err === 'object' && 'name' in err) {
    const name = (err as { name?: string }).name
    // `AbortError` is the canonical name, `TimeoutError` comes from the
    // explicit DOMException reason in `fetchWithTimeout`. Older undici
    // versions also leak a plain Error whose message is "signal is
    // aborted without reason" / "The operation was aborted" — treat
    // those as timeouts too rather than bubble the wire phrase to the
    // user's toast.
    if (
      name === 'AbortError' ||
      name === 'TimeoutError' ||
      /aborted/i.test(message)
    ) {
      return {
        success: false,
        error: 'Request timed out',
        durationMs,
      }
    }
  }
  return {
    success: false,
    error: `Network error: ${message}`,
    durationMs,
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s
}

function openAiApiRoot(baseUrl: string): string {
  const root = stripTrailingSlash(baseUrl.trim())
  return /\/v1$/i.test(root) ? root : `${root}/v1`
}
