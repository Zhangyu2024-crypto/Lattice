// Preview resolver for `detect_spectrum_type`. Extracted from
// `register-spectrum-previews.tsx` with zero behavior change — the
// registration itself stays in the sibling register-* file so the
// side-effect order is preserved.

import type { ReactNode } from 'react'
import type { ToolPreviewResolver } from '../preview-registry'

interface DetectTypeOutput {
  type?: string
  confidence?: number
  reasons?: string[]
}

export const detectSpectrumTypePreview: ToolPreviewResolver = (step) => {
  const out = (step.output ?? {}) as DetectTypeOutput
  const conf =
    out.confidence != null ? `${Math.round(out.confidence * 100)}%` : undefined
  const oneLiner = [out.type?.toUpperCase(), conf].filter(Boolean).join(' · ')
  const reasons = (out.reasons ?? []).slice(0, 3)
  const compact: ReactNode | undefined =
    reasons.length > 0 ? (
      <ul className="agent-card-list">
        {reasons.map((r, i) => (
          <li key={i}>
            <span className="agent-card-row-main">{r}</span>
          </li>
        ))}
      </ul>
    ) : undefined
  return { oneLiner: oneLiner || undefined, compact }
}
