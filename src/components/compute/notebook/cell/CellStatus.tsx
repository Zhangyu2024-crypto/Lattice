// Cell status chip + meta formatter — extracted from ComputeCellView.
//
// Renders the Running / OK / Error / Idle pill shown next to the kind
// chip in each cell's header. `formatMeta` produces the "time · duration
// · exit N" suffix that follows the status chip, and `runStatus`
// collapses a ComputeProRun into the two buckets the chip cares about.

import { AlertCircle, Check, Loader2 } from 'lucide-react'
import type { ComputeCell, ComputeProRun } from '../../../../types/artifact'

export function CellStatus({
  cell,
  isRunning,
}: {
  cell: ComputeCell
  isRunning: boolean
}) {
  if (isRunning) {
    return (
      <span className="compute-nb-status-chip is-running">
        <Loader2 size={10} className="spin" aria-hidden />
        Running
      </span>
    )
  }
  const run = cell.lastRun
  if (!run) {
    return <span className="compute-nb-status-chip is-idle">Idle</span>
  }
  const status = runStatus(run)
  return (
    <span className={`compute-nb-status-chip is-${status}`}>
      {status === 'ok' ? (
        <Check size={10} aria-hidden />
      ) : (
        <AlertCircle size={10} aria-hidden />
      )}
      {status === 'ok' ? 'OK' : 'Error'}
    </span>
  )
}

export function formatMeta(run: ComputeProRun | null): string {
  if (!run || run.endedAt == null) return ''
  const ts = new Date(run.startedAt).toLocaleTimeString()
  const dur = run.durationMs != null ? `${run.durationMs}ms` : ''
  const exit =
    run.cellKind === 'structure-ai' || run.exitCode == null
      ? ''
      : `exit ${run.exitCode}`
  return [ts, dur, exit].filter(Boolean).join(' · ')
}

export function runStatus(run: ComputeProRun): 'ok' | 'err' {
  if (run.timedOut || run.error) return 'err'
  if (run.exitCode != null && run.exitCode !== 0) return 'err'
  if (run.cellKind === 'structure-ai' && !run.stdout.trim()) return 'err'
  return 'ok'
}
