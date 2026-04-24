// Small stateless helpers shared by the orchestrator modules: id
// generation, abort-signal propagation, and a placeholder signal for
// callers that don't supply their own AbortController.

/** Module-level signal used when the caller doesn't supply one. Wrapping
 *  everywhere in `signal?` checks would work too, but a single always-
 *  settled AbortSignal keeps the loop body readable. */
export const NEVER_ABORT_SIGNAL = new AbortController().signal

export function genTaskId(): string {
  return `agent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export function genStepId(
  iteration: number,
  index: number,
  toolUseId: string,
): string {
  return `step_${iteration}_${index}_${toolUseId}`
}

export function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  const reason =
    typeof signal.reason === 'string'
      ? signal.reason
      : signal.reason instanceof Error
        ? signal.reason.message
        : 'Aborted'
  throw new Error(reason)
}
