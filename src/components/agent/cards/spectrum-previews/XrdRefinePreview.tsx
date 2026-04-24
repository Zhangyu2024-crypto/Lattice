// Preview resolver for `xrd_refine`. Extracted from
// `register-spectrum-previews.tsx` with zero behavior change — the
// registration itself stays in the sibling register-* file so the
// side-effect order is preserved.

import type { ReactNode } from 'react'
import type {
  Artifact,
  XrdProArtifact,
  XrdProRefineResult,
} from '../../../../types/artifact'
import { isXrdProArtifact } from '../../../../types/artifact'
import type { ToolPreviewResolver } from '../preview-registry'

interface XrdRefineOutput {
  rwp?: number
  gof?: number
  converged?: boolean
  phaseCount?: number
}

function extractRefineResult(
  artifact: Artifact | undefined,
): XrdProRefineResult | null {
  if (!artifact || !isXrdProArtifact(artifact)) return null
  const xrd = artifact as XrdProArtifact
  return xrd.payload.refineResult ?? null
}

export const xrdRefinePreview: ToolPreviewResolver = (step, artifact) => {
  const out = (step.output ?? {}) as XrdRefineOutput
  const parts: string[] = []
  if (out.rwp != null) parts.push(`Rwp=${out.rwp.toFixed(2)}%`)
  if (out.gof != null) parts.push(`GoF=${out.gof.toFixed(2)}`)
  if (out.phaseCount != null)
    parts.push(`${out.phaseCount} phase${out.phaseCount === 1 ? '' : 's'}`)
  if (out.converged != null) parts.push(out.converged ? 'converged' : 'not converged')

  const refine = extractRefineResult(artifact)
  const phases = (refine?.phases ?? []).slice(0, 3)
  const compact: ReactNode | undefined =
    phases.length > 0 ? (
      <ul className="agent-card-list">
        {phases.map((p, i) => {
          const cell = [p.a, p.b, p.c]
            .map((v) => (v != null ? v.toFixed(3) : '—'))
            .join(' / ')
          return (
            <li key={i}>
              <span className="agent-card-row-main">
                {p.phase_name ?? `phase ${i + 1}`}
                {p.hermann_mauguin ? (
                  <span className="agent-card-row-sub"> · {p.hermann_mauguin}</span>
                ) : null}
              </span>
              <span className="agent-card-row-meta">
                {p.weight_pct != null ? `${p.weight_pct.toFixed(1)}%` : '—'}
                <span className="agent-card-row-sub"> · a/b/c = {cell}</span>
              </span>
            </li>
          )
        })}
      </ul>
    ) : undefined
  return { oneLiner: parts.join(' · ') || undefined, compact }
}
