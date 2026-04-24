// Pure helper functions extracted from AgentCard.tsx. Kept separate so the
// main component file focuses on composition. No React imports — these all
// operate on plain values.

import type { TaskStep } from '../../../../types/session'
import type { MentionRef } from '../../../../types/mention'
import type { LocalTool, CardMode } from '../../../../types/agent-tool'
import { LOCAL_TOOL_CATALOG } from '../../../../lib/agent-tools'
import type { StatusTone } from './constants'

export function statusTone(status: TaskStep['status'] | undefined): StatusTone {
  if (status === 'running') return 'running'
  if (status === 'failed') return 'failed'
  if (status === 'succeeded') return 'succeeded'
  return 'muted'
}

export function formatDuration(step: TaskStep): string {
  if (!step.endedAt || !step.startedAt) return ''
  const ms = step.endedAt - step.startedAt
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms / 1000)}s`
}

export function mentionArtifactId(m: MentionRef): string | null {
  if (m.type === 'artifact') return m.artifactId
  if (m.type === 'artifact-element') return m.artifactId
  return null
}

/** Phase ε — resolve a step's presentation mode by consulting the
 *  LocalTool catalog. Mirrors the orchestrator's `resolveCardMode` but
 *  without importing from the orchestrator module (which would drag
 *  runtime deps into this component). */
export function resolveStepCardMode(
  step: TaskStep,
  tool?: LocalTool,
): CardMode {
  // Silent tools never render a card in the conversation — only through
  // the assistant-message audit chip. Preserve the signal regardless of
  // approval state (silent tools don't use approval).
  if (tool?.cardMode === 'silent') return 'silent'
  // A step that's mid-flight or finished without needing approval is
  // always read-only, even if the catalog entry claims `edit` mode —
  // the gate only exists while `approvalState === 'pending'`.
  if (step.approvalState !== 'pending') return 'info'
  if (tool?.cardMode) return tool.cardMode
  if (tool?.approvalPolicy === 'require') return 'edit'
  return 'info'
}

/** Cheap lookup the message-level audit chip uses to decide whether a
 *  tool step should be suppressed from the main card stream. Exported
 *  because `MessageBubble` renders the "used N tools" chip itself. */
export function isSilentStep(step: TaskStep): boolean {
  const tool = LOCAL_TOOL_CATALOG.find((t) => t.name === step.toolName)
  return tool?.cardMode === 'silent'
}

/**
 * Heuristic: does this `*Summary` string look like raw JSON (i.e. the
 * orchestrator stringified a structured tool payload for us)?
 *
 * The orchestrator's `summarizeToolOutput` / `summarizeToolInput` pass
 * structured objects through `JSON.stringify` + truncation, so when a
 * tool-specific preview isn't available the fallback path ends up quoting
 * `{"content":"<N B elided>","sizeBytes":N}` in the chat — noise with no
 * signal the user can act on. This check lets callers short-circuit to
 * a `null` render instead.
 *
 * Conservative on purpose: we only flag values that begin with a JSON
 * literal opener (`{`, `[`, `"`). Anything else — "Succeeded", "47 peaks",
 * free text — is left through so legitimate human-readable summaries keep
 * rendering.
 */
export function looksLikeJsonBlob(value: string): boolean {
  const trimmed = value.trimStart()
  if (trimmed.length === 0) return false
  const first = trimmed[0]
  return first === '{' || first === '[' || first === '"'
}
