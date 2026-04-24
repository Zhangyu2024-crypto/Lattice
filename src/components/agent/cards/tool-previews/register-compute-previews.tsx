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
  exitCode?: number | null
  figureCount?: number
  stdoutTail?: string
  summary?: string
}

registerToolPreview('compute_run', (step) => {
  const out = (step.output ?? {}) as ComputeRunOut
  const exit = out.exitCode
  const figures = out.figureCount ?? 0
  const tailLines = (out.stdoutTail ?? '')
    .split('\n')
    .filter((l) => l.length > 0)
    .slice(-6)
  const statusLabel =
    exit == null ? 'no exit' : exit === 0 ? 'ok' : `exit ${exit}`
  return {
    oneLiner: `${statusLabel} · ${figures} figure${figures === 1 ? '' : 's'}`,
    compact: tailLines.length > 0 ? (
      <pre className="agent-card-code-block">{tailLines.join('\n')}</pre>
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
