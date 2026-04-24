// In-turn microcompact for the agent orchestrator's message stream.
//
// Port of claude-code-main / services/compact/microCompact.ts, simplified
// to match Lattice's architecture:
//
// - Transcripts persist only plain-text user/assistant turns; tool_use /
//   tool_result blocks live exclusively inside a single `runAgentTurn`
//   call (see `agent-orchestrator.ts`). That means cross-turn decay is
//   already aggressive — our job is the WITHIN-turn case where 5+
//   iterations can pile up heavy `workspace_bash` / `workspace_read_file`
//   outputs that blow the window before the model can respond.
//
// - We therefore run count-based clearing of old tool_result blocks for
//   tools in `COMPACTABLE_TOOLS`: keep the last N results intact (the
//   model is still reasoning about them) and replace earlier ones with
//   the same sentinel upstream uses. Tools outside the whitelist
//   (detect_peaks, latex_edit_selection, …) are preserved because their
//   outputs carry artifact / UI state the model references later.
//
// - The triggers piggy-back on the same pass:
//     * #2 (time-based): cleared when iterations accumulate past the
//       keep-recent window, which inside a single long turn correlates
//       with wall-clock drift away from the most-recent user message.
//     * #4 (turn-based decay): the same count trigger covers iteration
//       depth; see `maybeMicrocompactMessages` below.

import type {
  LlmMessageBlockPayload,
  LlmMessagePayload,
} from '../types/electron'

/** Exact string upstream uses for cleared tool_result bodies. Keeping it
 *  verbatim makes the prompt-level contract obvious if a future port ever
 *  needs to cross-reference. */
export const TIME_BASED_MC_CLEARED_MESSAGE = '[Old tool result content cleared]'

/** Tools whose outputs are retrieval-only and thus safe to forget once
 *  the model has responded. Anything stateful (creates artifacts, mutates
 *  files, produces rich cards the user inspects) is deliberately absent
 *  so its output stays in context for subsequent iterations. */
export const COMPACTABLE_TOOLS = new Set<string>([
  // Workspace retrieval surface
  'workspace_read_file',
  'workspace_grep',
  'workspace_glob',
  'workspace_bash',
  // Literature / knowledge retrieval
  'literature_search',
  'knowledge_search',
  'paper_rag_ask',
  'list_papers',
  // Artifact / meta lookups
  'list_artifacts',
  'get_artifact',
  'tool_search',
  'task_list',
])

/** Keep at least the last three compactable results intact. Anything
 *  older is content-cleared. Chosen to match the typical plan-draft-fix
 *  cycle: the model usually needs the last one or two retrieval results
 *  active; earlier ones have already been summarised into its plan. */
export const MICROCOMPACT_KEEP_RECENT = 3

interface MicrocompactResult {
  messages: LlmMessagePayload[]
  cleared: number
}

/**
 * Walk `messages`, match every `tool_result` block to the `tool_use`
 * that spawned it, and if the total number of COMPACTABLE_TOOLS results
 * exceeds `keepRecent`, content-clear all but the most recent
 * `keepRecent` of them. Non-compactable tools, non-tool blocks and the
 * surrounding assistant / user messages are preserved unchanged.
 *
 * The function is pure: it returns a new messages array when at least
 * one block was rewritten, or the exact input array otherwise so
 * reference-equality callers (e.g. memoized selectors) don't churn.
 */
export function maybeMicrocompactMessages(
  messages: ReadonlyArray<LlmMessagePayload>,
  keepRecent: number = MICROCOMPACT_KEEP_RECENT,
): MicrocompactResult {
  if (messages.length === 0) return { messages: messages.slice(), cleared: 0 }

  // 1) Build tool_use_id → tool_name so we can classify each tool_result.
  //    `tool_use` blocks sit on assistant messages; we walk once to collect.
  const toolNames = new Map<string, string>()
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    if (!Array.isArray(msg.content)) continue
    for (const block of msg.content) {
      if (block.type === 'tool_use') toolNames.set(block.id, block.name)
    }
  }

  // 2) Enumerate compactable tool_result positions in encounter order.
  const compactable: Array<{ msgIdx: number; blockIdx: number; toolUseId: string }> =
    []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.role !== 'user') continue
    if (!Array.isArray(msg.content)) continue
    for (let j = 0; j < msg.content.length; j++) {
      const block = msg.content[j]
      if (block.type !== 'tool_result') continue
      const name = toolNames.get(block.tool_use_id)
      if (!name || !COMPACTABLE_TOOLS.has(name)) continue
      compactable.push({ msgIdx: i, blockIdx: j, toolUseId: block.tool_use_id })
    }
  }

  const keep = Math.max(1, keepRecent)
  if (compactable.length <= keep) {
    return { messages: messages.slice(), cleared: 0 }
  }
  const clearTargets = compactable.slice(0, compactable.length - keep)

  // 3) Produce a shallow-cloned message array where only the affected
  //    user messages are rebuilt — preserves reference identity for
  //    untouched messages so downstream consumers can shortcut equality.
  const next: LlmMessagePayload[] = messages.slice()
  const dirty = new Set<number>()
  for (const { msgIdx, blockIdx } of clearTargets) {
    const msg = next[msgIdx]
    if (!Array.isArray(msg.content)) continue
    if (!dirty.has(msgIdx)) {
      next[msgIdx] = { ...msg, content: msg.content.slice() }
      dirty.add(msgIdx)
    }
    const content = next[msgIdx].content as LlmMessageBlockPayload[]
    const block = content[blockIdx]
    if (block.type !== 'tool_result') continue
    if (block.content === TIME_BASED_MC_CLEARED_MESSAGE) continue
    content[blockIdx] = { ...block, content: TIME_BASED_MC_CLEARED_MESSAGE }
  }

  return { messages: next, cleared: clearTargets.length }
}
