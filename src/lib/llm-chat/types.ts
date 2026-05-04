// Public types for the unified LLM chat surface. Split from `llm-chat.ts`
// as part of a pure code-motion refactor — no behaviour changes.

import type { LocalTool, ToolCallRequest } from '../../types/agent-tool'
import type { LlmMessagePayload } from '../../types/electron'
import type { ComposerMode } from '../../types/llm'
import type { MentionRef } from '../../types/mention'
import type { TranscriptMessage } from '../../types/session'

/**
 * Only the schema surface of a `LocalTool` is ever sent over IPC —
 * `execute` stays local. This typed alias makes the contract explicit so
 * callers can't accidentally pass an arbitrary object as a tool.
 */
export type ToolDefinitionLike = Pick<
  LocalTool<unknown, unknown>,
  'name' | 'description' | 'inputSchema'
>

export interface LlmChatRequest {
  /** 'dialog' reads dialog config (temp=0.7, short), 'agent' reads agent
   *  config (temp=0, long). */
  mode: ComposerMode
  /** The user's new message text. */
  userMessage: string
  /** Recent transcript (both roles) for context. The function trims to fit
   *  the per-request token budget — never by message count. */
  transcript: TranscriptMessage[]
  /** For usage tracking. */
  sessionId: string | null
  /**
   * Mentions attached to this turn. Each entry's `anchor` is expected to
   * appear inside `userMessage` as `@[label#anchor](mention://…)`; the LLM
   * sees a matching context block whose header is the anchor.
   */
  mentions?: Array<{ anchor: string; ref: MentionRef }>
  /**
   * Inline images for this user turn (base64, no `data:` prefix). Sent as
   * multimodal blocks on the trailing user message; requires Electron
   * `llmInvoke` (main-process proxy supports Anthropic + OpenAI vision).
   */
  images?: ReadonlyArray<{ base64: string; mediaType: string }>
  /**
   * Orchestrator-supplied conversation. When present, it replaces the
   * transcript-derived history (with `userMessage` still appended if it
   * isn't already the tail). This is how the agent loop threads
   * `tool_use` / `tool_result` blocks back into the next turn.
   */
  messages?: LlmMessagePayload[]
  /**
   * Tool schemas to expose to the model this turn. Only honored in Agent
   * mode; Dialog mode is a hard "no tools" surface per design.
   */
  tools?: ToolDefinitionLike[]
  /**
   * When provided AND the active provider is Anthropic AND Electron
   * streaming IPC is available, the call uses the streaming transport so
   * the callback fires for every incremental text token. The final
   * `LlmChatResult` is the same shape either way. Dialog and
   * non-Anthropic paths ignore this field and use the one-shot transport.
   */
  onTextDelta?: (delta: string) => void
  /**
   * Override the system prompt from the config store. Used by internal
   * callers (XRD identification, structure code gen) that need a
   * domain-specific system prompt instead of the default dialog/agent one.
   */
  systemPromptOverride?: string
  /**
   * Optional per-request model binding override. Fields supplied here win
   * over the session-level `/model` / `/fast` / `/effort` overrides, which
   * in turn win over the store's mode defaults. See
   * `src/lib/model-routing/` for the full precedence ladder.
   */
  modelBindingOverride?: import('../model-routing').ModelBinding
  /** Optional cancellation signal. Streaming calls are aborted at the IPC
   *  layer; one-shot calls return early on abort and ignore the late result. */
  signal?: AbortSignal
  /** Optional audit labels passed through to the Electron main process.
   *  They are used only for local call logging, not forwarded to providers. */
  audit?: {
    source?: string
    metadata?: Record<string, unknown>
  }
}

export interface LlmChatResult {
  success: boolean
  content: string
  error?: string
  durationMs: number
  inputTokens: number
  outputTokens: number
  /** Tool-use requests parsed from the provider response. Empty / absent
   *  means the model emitted a normal text reply only. */
  toolCalls?: ToolCallRequest[]
  /** The assistant turn as the proxy saw it, in provider-neutral shape.
   *  Orchestrator splices this back into the next turn's messages array so
   *  the model has its own prior turn as context when tool results come
   *  back. */
  messages?: LlmMessagePayload[]
  /** Concatenated thinking blocks from an extended-thinking response.
   *  Only present when the model produced thinking content. */
  thinkingContent?: string
}
