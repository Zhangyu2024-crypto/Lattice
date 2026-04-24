// Phase α — promise-based bridge between the ToolCallCard (user action)
// and `runAgentTurn()` (awaiting a tool approval). Lives in its own
// module so both the orchestrator and the session-store can import from
// it without creating a circular dependency — session-store calls
// `resolvePendingApproval` from its `setStepApproval` action, and the
// orchestrator fills the map via `registerPendingApproval`.
//
// The key is the **backend step id** (`step_<iteration>_<index>_<toolUseId>`)
// that the orchestrator stamps on every `tool_invocation` WS event; the
// same key is persisted onto the session TaskStep as `backendStepId` so
// the store can round-trip a click on a card back to the awaiting
// promise.

import type { StepApprovalState } from '../types/session'

export interface StepApprovalResolution {
  state: StepApprovalState
  /** Optional user-edited replacement for the raw tool output. Only
   *  consumed when `state === 'approved'`. */
  editedOutput?: unknown
}

interface PendingEntry {
  resolve: (value: StepApprovalResolution) => void
}

const pending = new Map<string, PendingEntry>()

/** Register a pending approval. Returns a promise that resolves when
 *  `resolvePendingApproval` is called with the matching backend step id.
 *  The orchestrator awaits this promise before continuing the loop. */
export function registerPendingApproval(
  backendStepId: string,
): Promise<StepApprovalResolution> {
  return new Promise<StepApprovalResolution>((resolve) => {
    pending.set(backendStepId, { resolve })
  })
}

/** Resolve an outstanding approval wait. No-op when the id is unknown —
 *  either the orchestrator never registered (e.g. an auto-approved tool),
 *  or the wait was already consumed. Returns true on match so callers
 *  can log diagnostic misses during development. */
export function resolvePendingApproval(
  backendStepId: string,
  resolution: StepApprovalResolution,
): boolean {
  const entry = pending.get(backendStepId)
  if (!entry) return false
  pending.delete(backendStepId)
  entry.resolve(resolution)
  return true
}

/** Discard any outstanding waits — invoked on turn reset so a crashed
 *  orchestrator does not leave stuck pending entries in memory. The
 *  discarded waits are resolved as `rejected` so the caller can unwind
 *  cleanly if it happens to still be listening. */
export function clearPendingApprovals(): void {
  for (const [, entry] of pending) {
    entry.resolve({ state: 'rejected' })
  }
  pending.clear()
}
