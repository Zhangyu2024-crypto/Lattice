// Selective clearing of stale tool_result content blocks.
//
// Tool results from earlier iterations carry large payloads (file contents,
// search results, bash output) that the model has already reasoned about.
// Replacing the body with a short sentinel saves context space without
// losing the structural record of which tool was called. The companion
// `tool_use` blocks on assistant messages are left untouched — providers
// require a tool_use/tool_result pair to validate the conversation.
//
// This runs on every orchestrator iteration as a lightweight pre-pass
// before the heavier compaction check, mirroring the micro-compact
// pattern in `agent-compact.ts` but operating on ALL tool results rather
// than just the compactable-tools whitelist.

import type {
  LlmMessageBlockPayload,
  LlmMessagePayload,
} from '../../types/electron'

/** Sentinel text that replaces cleared tool_result bodies. Kept terse —
 *  the model sees it on every subsequent turn; verbosity wastes tokens. */
export const CLEARED_TOOL_RESULT_SENTINEL = '[cleared to save context]'

export interface ClearResult {
  messages: LlmMessagePayload[]
  cleared: number
}

/**
 * Walk `messages` and replace the content of all tool_result blocks except
 * the most-recent `keepLastN` with {@link CLEARED_TOOL_RESULT_SENTINEL}.
 *
 * Only `tool_result` blocks inside user messages with array content are
 * touched. Assistant-side `tool_use` blocks remain intact — the provider
 * API requires a matching tool_use record for every tool_result.
 *
 * Returns a shallow-cloned messages array (untouched messages keep
 * reference identity) and the number of blocks that were actually cleared
 * (skips blocks already carrying the sentinel).
 */
export function clearOldToolResults(
  messages: LlmMessagePayload[],
  keepLastN: number = 4,
): ClearResult {
  if (messages.length === 0) {
    return { messages: [], cleared: 0 }
  }

  // 1. Enumerate every tool_result position in encounter order.
  const positions: Array<{ msgIdx: number; blockIdx: number }> = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.role !== 'user' || typeof msg.content === 'string') continue
    for (let j = 0; j < msg.content.length; j++) {
      if (msg.content[j].type === 'tool_result') {
        positions.push({ msgIdx: i, blockIdx: j })
      }
    }
  }

  const keep = Math.max(1, keepLastN)
  if (positions.length <= keep) {
    return { messages: messages.slice(), cleared: 0 }
  }

  // Everything before the last `keep` entries gets cleared.
  const toClear = positions.slice(0, positions.length - keep)

  // 2. Shallow-clone only the messages that need mutation.
  const next: LlmMessagePayload[] = messages.slice()
  const clonedMsgIndices = new Set<number>()
  let cleared = 0

  for (const { msgIdx, blockIdx } of toClear) {
    if (!clonedMsgIndices.has(msgIdx)) {
      const msg = next[msgIdx]
      if (typeof msg.content === 'string') continue
      next[msgIdx] = { ...msg, content: msg.content.slice() }
      clonedMsgIndices.add(msgIdx)
    }
    const content = next[msgIdx].content as LlmMessageBlockPayload[]
    const block = content[blockIdx]
    if (block.type !== 'tool_result') continue
    // Skip blocks already cleared (idempotent re-runs).
    if (block.content === CLEARED_TOOL_RESULT_SENTINEL) continue
    content[blockIdx] = { ...block, content: CLEARED_TOOL_RESULT_SENTINEL }
    cleared++
  }

  return { messages: next, cleared }
}
