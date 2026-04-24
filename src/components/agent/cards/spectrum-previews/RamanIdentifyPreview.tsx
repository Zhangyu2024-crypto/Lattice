// Preview resolver for `raman_identify`. Extracted from
// `register-spectrum-previews.tsx` with zero behavior change — the
// registration itself stays in the sibling register-* file so the
// side-effect order is preserved.

import type { ReactNode } from 'react'
import type { ToolPreviewResolver } from '../preview-registry'
import { confidenceBar } from './helpers'

interface RamanIdentifyOutput {
  matches?: Array<{
    name?: string
    formula?: string
    score?: number
  }>
}

export const ramanIdentifyPreview: ToolPreviewResolver = (step) => {
  const out = (step.output ?? {}) as RamanIdentifyOutput
  const matches = out.matches ?? []
  const top = matches.slice(0, 3)
  const oneLiner = matches.length === 0
    ? 'no matches'
    : `${matches.length} match${matches.length === 1 ? '' : 'es'}${
        top[0]?.name ? ` · top: ${top[0].name}` : ''
      }`
  const compact: ReactNode | undefined =
    top.length > 0 ? (
      <ul className="agent-card-list">
        {top.map((m, i) => (
          <li key={i}>
            <span className="agent-card-row-main">
              {m.name ?? '—'}
              {m.formula ? (
                <span className="agent-card-row-sub"> · {m.formula}</span>
              ) : null}
            </span>
            <span className="agent-card-row-meta">
              {m.score != null ? m.score.toFixed(2) : '—'}
              {confidenceBar(m.score)}
            </span>
          </li>
        ))}
      </ul>
    ) : undefined
  return { oneLiner, compact }
}
