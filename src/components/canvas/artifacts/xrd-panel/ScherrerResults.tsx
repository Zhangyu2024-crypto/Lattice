// Per-peak Scherrer crystallite-size table. Deconvolves the instrumental
// FWHM from each observed peak, runs the Scherrer equation with the
// user-chosen K factor and wavelength, and shows both the per-peak sizes
// and a mean. Entirely client-side — no backend dependency.

import { useMemo } from 'react'
import {
  WAVELENGTH_TO_ANGSTROM,
  deconvolveInstrumentalFwhm,
  scherrerSize,
} from '../../../../lib/xrd-instruments'
import type { XrdProPeak } from '../../../../types/artifact'
import { ProEmpty } from '../../../common/pro'
import { S } from '../XrdProWorkbench.styles'

interface ScherrerResultsProps {
  peaks: XrdProPeak[]
  kFactor: number
  instrumentalFwhm: number
  wavelength: string
}

export default function ScherrerResults({
  peaks,
  kFactor,
  instrumentalFwhm,
  wavelength,
}: ScherrerResultsProps) {
  const { rows, mean } = useMemo(() => {
    const wl = WAVELENGTH_TO_ANGSTROM[wavelength] ?? 1.5406
    const r = peaks
      .filter((p) => p.fwhm != null && p.fwhm > 0)
      .map((p) => {
        const obs = p.fwhm as number
        const corrected = deconvolveInstrumentalFwhm(obs, instrumentalFwhm)
        return {
          pos: p.position,
          fwhm: obs,
          fwhmCorr: corrected,
          size: scherrerSize(kFactor, wl, p.position, corrected),
        }
      })
    const valid = r.filter((x) => x.size > 0)
    const m =
      valid.length > 0
        ? valid.reduce((acc, x) => acc + x.size, 0) / valid.length
        : 0
    return { rows: r, mean: m }
  }, [peaks, kFactor, instrumentalFwhm, wavelength])
  if (rows.length === 0) {
    return (
      <ProEmpty compact>Detect peaks with FWHM to calculate size</ProEmpty>
    )
  }
  return (
    <>
      {mean > 0 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            padding: '4px 8px',
            fontSize: 'var(--text-xxs)',
            color: 'var(--color-text-muted)',
          }}
        >
          <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Mean L
          </span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-primary)',
            }}
          >
            {mean.toFixed(1)} nm
          </span>
        </div>
      )}
      <div style={S.scherrerTable}>
        <div style={S.scherrerHead}>
          <span>2θ</span>
          <span>FWHM</span>
          <span>L (nm)</span>
        </div>
        {rows.slice(0, 20).map((r, i) => (
          <div key={`sch-${i}`} style={S.scherrerRow}>
            <span>{r.pos.toFixed(2)}</span>
            <span>{r.fwhm.toFixed(3)}</span>
            <span className="workbench-xrd-panel-size-cell">
              {r.size > 0 ? r.size.toFixed(1) : '—'}
            </span>
          </div>
        ))}
        {rows.length > 20 && (
          <div
            style={{
              fontSize: 'var(--text-xxs)',
              color: 'var(--color-text-muted)',
              padding: '4px 8px',
            }}
          >
            +{rows.length - 20} more…
          </div>
        )}
      </div>
    </>
  )
}
