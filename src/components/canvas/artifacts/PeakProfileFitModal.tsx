// Single-peak pseudo-Voigt profile fitter — opens when the user clicks a
// peak row in the XRD peak table. Shows the windowed data (±HALF_WINDOW
// around the peak), a live model overlay that follows the four sliders,
// and an "Auto fit" button that runs Levenberg-Marquardt locally.
//
// Why we ship this: FWHM from the coarse detect pass is good enough for
// sorting peaks but not for Scherrer / Williamson-Hall crystallite-size
// work (the LM fit typically tightens FWHM uncertainty by 5-10× on a
// well-isolated peak). The Apply path writes the refined FWHM +
// position back into `sub.peaks[idx]`, which both downstream analyses
// pick up automatically on the next render.

import { useEffect, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { X } from 'lucide-react'
import type { XrdProPeak } from '../../../types/artifact'
import {
  fitPseudoVoigt,
  pseudoVoigtCurve,
  type PseudoVoigtParams,
} from '../../../lib/pseudo-voigt-fit'
import { SliderRow } from './peak-profile-fit/SliderRow'
import { buildChartOption } from './peak-profile-fit/chart-option'
import { sliceAround } from './peak-profile-fit/helpers'
import { S } from './peak-profile-fit/styles'

export interface PeakProfileFitModalProps {
  open: boolean
  /** Peak to refine. `null` closes the modal. */
  peak: XrdProPeak | null
  /** Index of the peak inside `sub.peaks` — passed back to `onApply`. */
  peakIndex: number | null
  /** Full spectrum the peak lives in. Modal slices ±HALF_WINDOW around
   *  the peak for fitting + display. */
  spectrum: { x: number[]; y: number[] } | null
  /** Half-window in degrees 2θ around the peak. Default 1.5° matches
   *  the typical isolated-peak assumption for pseudo-Voigt LM fits. */
  halfWindow?: number
  onClose: () => void
  /** Called when the user accepts the refinement. Patch is shallow-merged
   *  into the peak in the module's handler. */
  onApply: (idx: number, patch: Partial<XrdProPeak>) => void
}

export default function PeakProfileFitModal({
  open,
  peak,
  peakIndex,
  spectrum,
  halfWindow = 1.5,
  onClose,
  onApply,
}: PeakProfileFitModalProps) {
  const windowed = useMemo(() => {
    if (!spectrum || !peak) return null
    return sliceAround(spectrum, peak.position, halfWindow)
  }, [spectrum, peak, halfWindow])

  const [params, setParams] = useState<PseudoVoigtParams | null>(null)
  const [result, setResult] = useState<{
    rSquared: number | null
    paramErrors: PseudoVoigtParams | null
    converged: boolean
  } | null>(null)

  // Re-seed whenever a new peak opens the modal. The seed uses the
  // caller's current intensity / fwhm / position; if any are missing we
  // fall back to sensible defaults so the LM solver has a starting point.
  useEffect(() => {
    if (!peak) {
      setParams(null)
      setResult(null)
      return
    }
    setParams({
      amplitude: peak.intensity > 0 ? peak.intensity : 1,
      center: peak.position,
      fwhm: peak.fwhm && peak.fwhm > 0 ? peak.fwhm : 0.15,
      eta: 0.5,
    })
    setResult(null)
  }, [peak])

  if (!open || !peak || peakIndex == null || !windowed || !params) return null

  const modelCurve = pseudoVoigtCurve(windowed.x, params)

  const handleAutoFit = () => {
    if (windowed.x.length < 5) {
      // Too few points for a 4-parameter fit to be well-conditioned.
      // Don't run — surface the state in the result area.
      setResult({
        rSquared: null,
        paramErrors: null,
        converged: false,
      })
      return
    }
    const r = fitPseudoVoigt(windowed.x, windowed.y, params, {
      // Keep the fit center inside the window so a badly-initialised
      // seed can't drift off to the side of the spectrum.
      bounds: {
        centerMin: peak.position - halfWindow,
        centerMax: peak.position + halfWindow,
        fwhmMin: 1e-3,
        fwhmMax: halfWindow,
      },
    })
    setParams(r.params)
    setResult({
      rSquared: r.rSquared,
      paramErrors: r.paramErrors,
      converged: r.converged,
    })
  }

  const handleApply = () => {
    onApply(peakIndex, {
      position: params.center,
      fwhm: params.fwhm,
      intensity: params.amplitude,
    })
    onClose()
  }

  const option = buildChartOption(windowed, modelCurve)

  return (
    <div style={S.backdrop} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <div style={S.header}>
          <span style={S.title}>
            Peak profile fit · #{peakIndex + 1} @ {peak.position.toFixed(3)}°
          </span>
          <button type="button" onClick={onClose} style={S.closeBtn} title="Close">
            <X size={14} />
          </button>
        </div>
        <div style={S.chartWrap}>
          <ReactECharts option={option} style={{ height: 240 }} />
        </div>
        <div style={S.controls}>
          <SliderRow
            label="Center"
            unit="°"
            min={peak.position - halfWindow}
            max={peak.position + halfWindow}
            step={halfWindow / 200}
            value={params.center}
            onChange={(v) => setParams({ ...params, center: v })}
          />
          <SliderRow
            label="FWHM"
            unit="°"
            min={0.01}
            max={halfWindow}
            step={halfWindow / 200}
            value={params.fwhm}
            onChange={(v) => setParams({ ...params, fwhm: v })}
          />
          <SliderRow
            label="η"
            unit="0=G, 1=L"
            min={0}
            max={1}
            step={0.01}
            value={params.eta}
            onChange={(v) => setParams({ ...params, eta: v })}
          />
          <SliderRow
            label="Amp"
            unit=""
            min={0}
            max={Math.max(params.amplitude * 3, 1)}
            step={Math.max(params.amplitude / 200, 0.1)}
            value={params.amplitude}
            onChange={(v) => setParams({ ...params, amplitude: v })}
          />
        </div>
        {result && (
          <div style={S.resultRow}>
            <span style={S.resultChip}>
              R²{' '}
              <span style={S.resultValue}>
                {result.rSquared != null ? result.rSquared.toFixed(4) : '—'}
              </span>
            </span>
            <span style={S.resultChip}>
              FWHM{' '}
              <span style={S.resultValue}>
                {params.fwhm.toFixed(4)}
                {result.paramErrors?.fwhm != null && (
                  <> ± {result.paramErrors.fwhm.toFixed(4)}</>
                )}
              </span>
            </span>
            <span style={S.resultChip}>
              Center{' '}
              <span style={S.resultValue}>
                {params.center.toFixed(4)}
                {result.paramErrors?.center != null && (
                  <> ± {result.paramErrors.center.toFixed(4)}</>
                )}
              </span>
            </span>
            {!result.converged && (
              <span style={{ ...S.resultChip, color: 'var(--color-text-muted)' }}>
                (did not converge)
              </span>
            )}
          </div>
        )}
        <div style={S.actions}>
          <button type="button" onClick={handleAutoFit} style={S.fitBtn}>
            Auto fit
          </button>
          <button type="button" onClick={handleApply} style={S.applyBtn}>
            Apply
          </button>
          <button type="button" onClick={onClose} style={S.cancelBtn}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
