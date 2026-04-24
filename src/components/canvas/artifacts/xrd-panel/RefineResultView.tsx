// Results readout for the whole-pattern fit. Shows Rwp / GoF /
// convergence, plus per-phase weights — optionally post-processed through
// the Reference Intensity Ratio (RIR) correction when the user enables
// QPA. Phases missing from the RIR table degrade to "—" rather than
// silently dropping out.

import { useMemo } from 'react'
import { applyRirCorrection } from '../../../../lib/xrd-rir'
import type { XrdProRefineResult } from '../../../../types/artifact'
import { S } from '../XrdProWorkbench.styles'

interface RefineResultViewProps {
  result: XrdProRefineResult
  qpaRir: boolean
  onToggleQpaRir: (next: boolean) => void
}

export default function RefineResultView({
  result,
  qpaRir,
  onToggleQpaRir,
}: RefineResultViewProps) {
  const corrected = useMemo(
    () => (qpaRir ? applyRirCorrection(result.phases) : null),
    [qpaRir, result.phases],
  )
  return (
    <div style={S.refineView}>
      <div style={S.refineStats}>
        {result.rwp != null && (
          <div style={S.refineStat}>
            <span style={S.refineStatLabel}>Rwp</span>
            <span style={S.refineStatValue}>{result.rwp.toFixed(2)}%</span>
          </div>
        )}
        {result.gof != null && (
          <div style={S.refineStat}>
            <span style={S.refineStatLabel}>GoF</span>
            <span style={S.refineStatValue}>{result.gof.toFixed(2)}</span>
          </div>
        )}
        {result.converged != null && (
          <div style={S.refineStat}>
            <span style={S.refineStatLabel}>Conv</span>
            <span style={S.refineStatValue}>
              {result.converged ? 'yes' : 'no'}
            </span>
          </div>
        )}
      </div>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 2px',
          fontSize: 'var(--text-xxs)',
          color: 'var(--color-text-muted)',
          cursor: 'pointer',
        }}
        title="Apply Reference Intensity Ratio correction. Uses a built-in table normalised to corundum Al₂O₃ = 1.0; phases not in the table show '—'."
      >
        <input
          type="checkbox"
          checked={qpaRir}
          onChange={(e) => onToggleQpaRir(e.currentTarget.checked)}
        />
        Apply RIR correction (QPA)
      </label>
      {result.phases.map((p, i) => {
        const corr = corrected?.[i]
        return (
          <div key={`rp-${i}`} style={S.refinePhase}>
            <div style={S.refinePhaseName}>
              {p.phase_name ?? `Phase ${i + 1}`}
            </div>
            {p.weight_pct != null && (
              <div style={S.refinePhaseMeta}>
                wt {p.weight_pct.toFixed(1)}%
                {qpaRir && (
                  <>
                    {' · RIR '}
                    {corr?.correctedPct != null
                      ? `${corr.correctedPct.toFixed(1)}%`
                      : '—'}
                  </>
                )}
                {p.hermann_mauguin ? ` · ${p.hermann_mauguin}` : ''}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
