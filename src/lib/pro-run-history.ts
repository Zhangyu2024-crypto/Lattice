// Pro Workbench run-history helpers.
//
// Every long-running Pro action (refine, fit, identify, detect-peaks, …)
// appends a `ProRunRecord` into the active sub-state's `runHistory`
// array via `appendRunRecord`. The left-rail `ProHistoryRail` reads them
// back so users can review what they've done and restore parameters from
// any row.
//
// Capping rules live here (shared by the store's partialize layer and the
// per-module appender) so a long session can't balloon localStorage and a
// 500 KB paramsSnapshot paste can't blow up the hot-path serialiser.

import type { ModuleCtx, ModuleActions } from '@/components/canvas/artifacts/pro/modules/types'
import type { ProRunRecord } from '@/types/artifact'

/** Keep the last 50 records per sub-state. Above that, oldest drops. */
export const RUN_HISTORY_MAX = 50
/** Stringified `paramsSnapshot` size cap. Past this the snapshot is
 *  replaced with a `{truncated: true}` marker — Restore can't replay but
 *  the rest of the record (including its result summary) stays visible. */
export const PARAMS_SNAPSHOT_MAX_BYTES = 16 * 1024

/** Generate a short opaque id for a record. */
export function runRecordId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

interface SubWithRunHistory {
  runHistory?: ProRunRecord[]
}

/** Append a record to the active sub-state's `runHistory`. Accepts a partial
 *  input; `id` and `createdAt` are filled if missing. Applies caps on the
 *  merged list length and on `paramsSnapshot` size. */
export function appendRunRecord<Sub extends SubWithRunHistory>(
  ctx: ModuleCtx<Sub>,
  partial: Omit<ProRunRecord, 'id' | 'createdAt'> & Partial<Pick<ProRunRecord, 'id' | 'createdAt'>>,
): void {
  const record: ProRunRecord = {
    id: partial.id ?? runRecordId(),
    createdAt: partial.createdAt ?? Date.now(),
    command: partial.command,
    paramsSummary: partial.paramsSummary,
    resultSummary: partial.resultSummary,
    paramsSnapshot: clipSnapshot(partial.paramsSnapshot),
    durationMs: partial.durationMs,
    failed: partial.failed,
  }
  const prev = ctx.sub.runHistory ?? []
  const next = [...prev, record].slice(-RUN_HISTORY_MAX)
  ctx.patchSubState({ runHistory: next } as Partial<Sub>)
}

/** Persist-layer cleaner: cap length + snapshot size, drop in-flight
 *  markers. Safe to call on `undefined`. */
export function sanitizeRunHistory(
  history: ProRunRecord[] | undefined,
): ProRunRecord[] | undefined {
  if (!history || history.length === 0) return history
  const tail = history.slice(-RUN_HISTORY_MAX)
  let dirty = tail.length !== history.length
  const out = tail.map((rec) => {
    const snap = clipSnapshot(rec.paramsSnapshot)
    if (snap !== rec.paramsSnapshot) dirty = true
    return snap === rec.paramsSnapshot ? rec : { ...rec, paramsSnapshot: snap }
  })
  return dirty ? out : history
}

function clipSnapshot(snapshot: unknown): unknown {
  if (snapshot == null) return snapshot
  let serialised: string
  try {
    serialised = JSON.stringify(snapshot)
  } catch {
    return { truncated: true, reason: 'unserialisable' }
  }
  if (serialised.length <= PARAMS_SNAPSHOT_MAX_BYTES) return snapshot
  return { truncated: true, reason: 'size', bytes: serialised.length }
}

// Re-export the type so consumers only import from this module.
export type { ProRunRecord } from '@/types/artifact'

// The module authors' helper — narrow the ctx to the subset this helper
// actually touches; prevents accidental type drift when new Sub fields
// land upstream. Module `Actions` bags don't matter for appending, but
// TypeScript's variance rules surface cleanly if we keep the generic.
export type RunnableModuleCtx<Sub extends SubWithRunHistory> = ModuleCtx<Sub> & {
  // Reserved for future expansion (e.g. `ctx.actions` if restoreParams ever
  // wants to re-run). For now the alias keeps downstream signatures tight
  // without leaking ModuleActions.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _unused?: ModuleActions
}
