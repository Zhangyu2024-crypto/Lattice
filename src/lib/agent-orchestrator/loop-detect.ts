// Detect when the agent is stuck on the same subgoal.
//
// The orchestrator used to stop on a hard iteration count, which cuts
// off legitimately long plans (research flows, multi-file refactors).
// The real signal we want is *repetition*: the model emits the same
// tool call with the same arguments turn after turn, usually because a
// tool keeps returning the same result and the model hasn't noticed.
//
// We canonicalise each tool call (sorted JSON of inputs) and combine
// all calls in one iteration into a single signature. When the last
// `window` iterations produce identical signatures, the turn bails
// with a clear error instead of silently burning more API budget.

import type { ToolCallRequest } from '../../types/agent-tool'

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return '[' + value.map(canonical).join(',') + ']'
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return (
    '{' +
    keys.map((k) => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') +
    '}'
  )
}

export function iterationSignature(calls: ToolCallRequest[]): string {
  if (calls.length === 0) return ''
  // Sort so parallel calls in different orders collapse to the same
  // signature — we care about the *set* of work requested this turn,
  // not the dispatch order.
  return calls
    .map((c) => `${c.name}:${canonical(c.input)}`)
    .sort()
    .join('|')
}

export function isStuckLoop(
  signatures: readonly string[],
  window: number,
): boolean {
  if (window < 2 || signatures.length < window) return false
  const tail = signatures.slice(-window)
  const first = tail[0]
  if (!first) return false
  return tail.every((s) => s === first)
}
