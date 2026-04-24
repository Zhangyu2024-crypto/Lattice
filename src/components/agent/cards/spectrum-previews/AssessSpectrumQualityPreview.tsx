// Preview resolver for `assess_spectrum_quality`. Extracted from
// `register-spectrum-previews.tsx` with zero behavior change — the
// registration itself stays in the sibling register-* file so the
// side-effect order is preserved.

import type { ReactNode } from 'react'
import type { ToolPreviewResolver } from '../preview-registry'

interface QualityOutput {
  grade?: 'good' | 'fair' | 'poor' | string
  snr?: number
  nPoints?: number
  issues?: string[]
  recommendations?: string[]
}

// Crude score: map good/fair/poor to 9 / 6 / 3 and nudge with SNR.
function qualityScore(out: QualityOutput): number | undefined {
  const base =
    out.grade === 'good' ? 9 : out.grade === 'fair' ? 6 : out.grade === 'poor' ? 3 : undefined
  if (base == null) return undefined
  const bonus = out.snr != null ? Math.max(-2, Math.min(1, (out.snr - 10) / 20)) : 0
  return Math.max(1, Math.min(10, Math.round(base + bonus)))
}

export const assessSpectrumQualityPreview: ToolPreviewResolver = (step) => {
  const out = (step.output ?? {}) as QualityOutput
  const score = qualityScore(out)
  const snr = out.snr != null ? `SNR ${out.snr.toFixed(1)}` : undefined
  const oneLiner = [
    out.grade ? String(out.grade).toUpperCase() : undefined,
    score != null ? `${score}/10` : undefined,
    snr,
  ]
    .filter(Boolean)
    .join(' · ')
  const topIssues = (out.issues ?? []).slice(0, 3)
  const compact: ReactNode | undefined =
    topIssues.length > 0 ? (
      <ul className="agent-card-list">
        {topIssues.map((issue, i) => (
          <li key={i}>
            <span className="agent-card-row-main">{issue}</span>
          </li>
        ))}
      </ul>
    ) : undefined
  return { oneLiner: oneLiner || undefined, compact }
}
