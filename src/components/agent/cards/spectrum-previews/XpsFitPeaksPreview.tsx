// Preview resolver for `xps_fit_peaks`. Extracted from
// `register-spectrum-previews.tsx` with zero behavior change — the
// registration itself stays in the sibling register-* file so the
// side-effect order is preserved.

import type { ReactNode } from 'react'
import type { XpsFitComponent } from '../../../../types/pro-api'
import type { ToolPreviewResolver } from '../preview-registry'

interface XpsFitOutput {
  components?: number
  componentDetails?: XpsFitComponent[]
  rSquared?: number
  reducedChiSquared?: number
}

export const xpsFitPeaksPreview: ToolPreviewResolver = (step) => {
  const out = (step.output ?? {}) as XpsFitOutput
  const count = out.components ?? out.componentDetails?.length ?? 0
  const oneLiner = [
    `${count} component${count === 1 ? '' : 's'}`,
    out.rSquared != null ? `R²=${out.rSquared.toFixed(3)}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ')
  const rows = (out.componentDetails ?? []).slice(0, 5)
  const compact: ReactNode | undefined =
    rows.length > 0 ? (
      <ul className="agent-card-list">
        {rows.map((c, i) => (
          <li key={i}>
            <span className="agent-card-row-main">{c.name || `#${i + 1}`}</span>
            <span className="agent-card-row-meta">
              BE {c.center_eV.toFixed(2)} · FWHM {c.fwhm_eV.toFixed(2)} · A{' '}
              {c.area.toFixed(1)}
            </span>
          </li>
        ))}
      </ul>
    ) : undefined
  return { oneLiner, compact }
}
