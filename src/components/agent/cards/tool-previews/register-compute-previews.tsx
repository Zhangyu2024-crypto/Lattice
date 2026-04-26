// Side-effect module: wires the compute_* agent-tool preview resolvers
// into the shared preview registry. Imported from AgentCard alongside the
// other register-* files so the side-effect fires exactly once at
// AgentCard bundle load.
//
// Each resolver is a pure function of (step, artifact). They intentionally
// avoid touching stores directly; AgentCard looks up the primary artifact
// and passes it in so preview logic stays deterministic + cheap.

import {
  isComputeArtifact,
  type ComputeArtifact,
} from '../../../../types/artifact'
import { registerToolPreview } from '../preview-registry'

// ─── compute_create_script ────────────────────────────────────────────

interface ComputeCreateScriptOut {
  artifactId?: string
  summary?: string
}

registerToolPreview('compute_create_script', (step, artifact) => {
  const out = (step.output ?? {}) as ComputeCreateScriptOut
  const compute = artifact && isComputeArtifact(artifact)
    ? (artifact as ComputeArtifact)
    : null
  const code = compute?.payload.code ?? ''
  const lines = code.split('\n')
  const lineCount = code.length === 0 ? 0 : lines.length
  const head = lines.slice(0, 10).join('\n')
  const title = compute?.title ?? 'compute script'
  return {
    oneLiner: `${title} · ${lineCount} line${lineCount === 1 ? '' : 's'}`,
    compact: code ? (
      <pre className="agent-card-code-block">{head}{lines.length > 10 ? '\n…' : ''}</pre>
    ) : out.summary ? (
      <span>{out.summary}</span>
    ) : undefined,
  }
})

// ─── compute_run ──────────────────────────────────────────────────────

interface ComputeRunOut {
  status?: string
  exitCode?: number | null
  figureCount?: number
  stdoutTail?: string
  summary?: string
  timedOut?: boolean
  background?: boolean
  progress?: { current: number; total: number; percent?: number }
}

function progressLabel(progress: ComputeArtifact['payload']['progress']): string {
  if (!progress || progress.total <= 0) return 'running'
  const pct = Math.min(100, Math.round((progress.current / progress.total) * 100))
  return `${progress.current}/${progress.total} · ${pct}%`
}

function tail(text: string, maxLines: number): string[] {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(-maxLines)
}

function RunningComputePreview({ compute }: { compute: ComputeArtifact }) {
  const stdoutLines = tail(compute.payload.stdout ?? '', 8)
  const stderrLines = tail(compute.payload.stderr ?? '', 4)
  return (
    <div className="agent-card-compute-process">
      <div className="agent-card-compute-process-head">
        <span>Running</span>
        <span>{progressLabel(compute.payload.progress)}</span>
      </div>
      {compute.payload.progress ? (
        <div className="agent-card-compute-process-track">
          <div
            className="agent-card-compute-process-fill"
            style={{
              width: `${Math.min(
                100,
                Math.round(
                  (compute.payload.progress.current / compute.payload.progress.total) * 100,
                ),
              )}%`,
            }}
          />
        </div>
      ) : (
        <div className="agent-card-compute-process-track">
          <div className="agent-card-compute-process-fill is-indeterminate" />
        </div>
      )}
      {stdoutLines.length || stderrLines.length ? (
        <pre className="agent-card-code-block agent-card-compute-process-log">
          {[...stdoutLines, ...stderrLines.map((line) => `[stderr] ${line}`)].join('\n')}
        </pre>
      ) : (
        <span className="agent-card-compute-process-empty">
          Process started. Waiting for output…
        </span>
      )}
    </div>
  )
}

registerToolPreview('compute_run', (step, artifact) => {
  const compute = artifact && isComputeArtifact(artifact)
    ? (artifact as ComputeArtifact)
    : null
  if (compute?.payload.status === 'running') {
    return {
      oneLiner: `${compute.title} · ${progressLabel(compute.payload.progress)}`,
      compact: <RunningComputePreview compute={compute} />,
    }
  }

  const out = (step.output ?? {}) as ComputeRunOut
  const exit = out.exitCode
  const figures = out.figureCount ?? 0
  const tailLines = (out.stdoutTail ?? '')
    .split('\n')
    .filter((l) => l.length > 0)
    .slice(-6)
  const statusLabel =
    out.status === 'running' || out.background
      ? 'running'
      : out.timedOut ? 'timeout' : exit == null ? 'no exit' : exit === 0 ? 'ok' : `exit ${exit}`
  return {
    oneLiner: `${statusLabel} · ${figures} figure${figures === 1 ? '' : 's'}`,
    compact: tailLines.length > 0 ? (
      <pre className="agent-card-code-block">{tailLines.join('\n')}</pre>
    ) : out.summary ? (
      <span>{out.summary}</span>
    ) : undefined,
  }
})

// ─── compute_status ───────────────────────────────────────────────────

interface ComputeStatusOut {
  kind?: string
  status?: string
  running?: boolean
  trustedResults?: boolean
  summary?: string
  progress?: { current: number; total: number; percent: number }
  stdoutTail?: string
  stderrTail?: string
  pointSummary?: {
    total: number
    succeeded: number
    failed: number
    cancelled: number
    running: number
  }
}

registerToolPreview('compute_status', (step) => {
  const out = (step.output ?? {}) as ComputeStatusOut
  const progress = out.progress
    ? `${out.progress.current}/${out.progress.total} · ${out.progress.percent}%`
    : null
  const pointText = out.pointSummary
    ? `${out.pointSummary.succeeded}/${out.pointSummary.total} points ok`
    : null
  const tails = [
    ...(out.stdoutTail ? out.stdoutTail.split('\n').slice(-4) : []),
    ...(out.stderrTail ? out.stderrTail.split('\n').slice(-3).map((line) => `[stderr] ${line}`) : []),
  ].filter((line) => line.trim().length > 0)
  return {
    oneLiner: [
      out.status ?? 'unknown',
      progress ?? pointText,
      out.trustedResults ? 'trusted' : 'not final',
    ].filter(Boolean).join(' · '),
    compact: tails.length > 0 ? (
      <pre className="agent-card-code-block">{tails.join('\n')}</pre>
    ) : out.summary ? (
      <span>{out.summary}</span>
    ) : undefined,
  }
})

// ─── compute_edit_script ──────────────────────────────────────────────

interface ComputeEditScriptOut {
  diffSize?: number
  oldLines?: number
  newLines?: number
  summary?: string
}

registerToolPreview('compute_edit_script', (step, artifact) => {
  const out = (step.output ?? {}) as ComputeEditScriptOut
  const compute = artifact && isComputeArtifact(artifact)
    ? (artifact as ComputeArtifact)
    : null
  const oldLines = out.oldLines
  const newLines = out.newLines ?? compute?.payload.code.split('\n').length
  const delta = out.diffSize
  const parts: string[] = []
  if (oldLines != null && newLines != null) {
    parts.push(`${oldLines} → ${newLines} lines`)
  } else if (newLines != null) {
    parts.push(`${newLines} lines`)
  }
  if (typeof delta === 'number') parts.push(`Δ${delta} chars`)
  return {
    oneLiner: parts.join(' · ') || out.summary,
    compact: out.summary ? <span>{out.summary}</span> : undefined,
  }
})
