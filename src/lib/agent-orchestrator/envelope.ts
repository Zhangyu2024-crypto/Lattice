// Tool-result envelope + summarization helpers.
//
// "Envelope" here covers everything that shapes a tool invocation for the
// two consumers of a step: the LLM (structured `tool_result` blocks fed
// back into the next iteration) and the UI (truncated, bulk-redacted
// strings surfaced in the chat header / audit chip / Task Timeline).

import type {
  LlmMessageBlockPayload,
  LlmMessagePayload,
  LlmToolResultBlockPayload,
  LlmToolUseBlockPayload,
} from '../../types/electron'
import type { LlmChatResult } from '../llm-chat'
import type { AgentToolStep } from './types'

function truncate(text: string, max = 240): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

export function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * Walk a value and replace any string longer than `maxStringLen` with a
 * size-only placeholder. Used before stringifying for the UI-facing
 * summary so bulk payloads (file bodies returned by `workspace_read_file`,
 * pasted content in `workspace_write_file`, etc.) don't end up verbatim
 * in the chat header / audit chip / persisted transcript. The LLM still
 * sees the full payload via the raw `tool_result` block — this only
 * redacts the human-readable summary string.
 */
export function redactBulkStrings(value: unknown, maxStringLen = 200): unknown {
  if (typeof value === 'string') {
    if (value.length <= maxStringLen) return value
    return `<${new Blob([value]).size} B elided>`
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactBulkStrings(v, maxStringLen))
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactBulkStrings(v, maxStringLen)
    }
    return out
  }
  return value
}

export function summarizeToolInput(input: Record<string, unknown>): string {
  return truncate(stringifyValue(redactBulkStrings(input)), 220)
}

export function summarizeToolOutput(output: unknown): string {
  return truncate(stringifyValue(redactBulkStrings(output)), 320)
}

/** Pull any artifact ids the step touched so the Timeline can jump-to the
 *  artifact a tool focused / inspected. Input-side `artifactId` covers
 *  focus_artifact / get_artifact; output-side `artifactIds` covers future
 *  tools that produce new artifacts. */
export function collectArtifactIds(
  input: Record<string, unknown>,
  output: unknown,
): string[] {
  const ids = new Set<string>()
  if (typeof input.artifactId === 'string') ids.add(input.artifactId)
  if (output && typeof output === 'object') {
    const obj = output as Record<string, unknown>
    if (typeof obj.artifactId === 'string') ids.add(obj.artifactId)
    if (Array.isArray(obj.artifactIds)) {
      for (const id of obj.artifactIds) {
        if (typeof id === 'string') ids.add(id)
      }
    }
  }
  return Array.from(ids)
}

/**
 * Reconstruct the assistant message the proxy handed back. When the proxy
 * gave us its own `messages` array we trust that (it's the provider's
 * native shape re-serialised); otherwise we synthesise one from the
 * `content` + `toolCalls` fields. Either way the result slots directly
 * into the next iteration's messages array.
 */
export function assistantMessageFromResult(
  result: LlmChatResult,
): LlmMessagePayload | null {
  if (result.messages && result.messages.length > 0) return result.messages[0]

  const blocks: Array<{ type: 'text'; text: string } | LlmToolUseBlockPayload> =
    []
  if (result.content) blocks.push({ type: 'text', text: result.content })
  for (const call of result.toolCalls ?? []) {
    blocks.push({
      type: 'tool_use',
      id: call.id,
      name: call.name,
      input: call.input,
    })
  }
  if (blocks.length === 0) return null
  return {
    role: 'assistant',
    content:
      blocks.length === 1 && blocks[0].type === 'text'
        ? blocks[0].text
        : (blocks as LlmMessageBlockPayload[]),
  }
}

export function toToolResultBlock(step: AgentToolStep): LlmToolResultBlockPayload {
  return {
    type: 'tool_result',
    tool_use_id: step.toolUseId,
    // Error outputs are stringified too, but wrapped so the model can see
    // they're an error rather than a normal result.
    content: stringifyValue(
      step.isError ? { error: step.output } : step.output,
    ),
  }
}
