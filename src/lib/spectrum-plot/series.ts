// Series / input-normalisation helpers. These turn the public
// ParsedSpectrum + PeakSpec + ReferenceSpec surface into the shapes
// `buildSpectrumChartOption` (pro-chart.ts) expects.

import type { ParsedSpectrum, SpectroscopyTechnique } from '../parsers/types'
import type { ProWorkbenchSpectrum, XrdProPeak } from '../../types/artifact'
import { CHART_SERIES_PALETTE } from '../chart-colors'
import type { PeakSpec, ReferenceSpec } from './types'

/** Convert `ParsedSpectrum` → the `ProWorkbenchSpectrum` shape the base
 *  option builder consumes. Technique + filename metadata are preserved
 *  so unit formatting works. */
export function toWorkbenchSpectrum(parsed: ParsedSpectrum): ProWorkbenchSpectrum {
  return {
    x: parsed.x,
    y: parsed.y,
    xLabel: parsed.xLabel,
    yLabel: parsed.yLabel,
    spectrumType: parsed.technique,
    sourceFile: parsed.metadata.sourceFile ?? null,
  }
}

/** Technique-aware heuristic for the XPS binding-energy convention. XPS
 *  axes descend (right → left), matplotlib uses `ax.invert_xaxis()`. */
export function techniqueReverseX(spectrum: ParsedSpectrum): boolean {
  if (spectrum.technique === 'XPS') return true
  const label = (spectrum.xLabel ?? '').toLowerCase()
  return label.includes('binding') || label.includes('kinetic')
}

export function techniqueToKind(t: SpectroscopyTechnique): string | undefined {
  switch (t) {
    case 'XRD':
      return 'xrd'
    case 'XPS':
      return 'xps'
    case 'Raman':
      return 'raman'
    case 'FTIR':
      return 'ftir'
    default:
      return undefined
  }
}

/** Look up the nearest (x, y) in the spectrum to a peak x-position so
 *  the markPoint label sits on the curve instead of floating at 0. */
function peakAnchor(spectrum: ParsedSpectrum, x: number): { pos: number; y: number } {
  const n = Math.min(spectrum.x.length, spectrum.y.length)
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < n; i++) {
    const d = Math.abs(spectrum.x[i] - x)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return { pos: spectrum.x[best], y: spectrum.y[best] }
}

export function toProPeaks(
  spectrum: ParsedSpectrum,
  raw: Array<number | PeakSpec> | undefined,
): XrdProPeak[] {
  if (!raw || raw.length === 0) return []
  return raw.map((p) => {
    const spec: PeakSpec = typeof p === 'number' ? { x: p } : p
    const { y } = peakAnchor(spectrum, spec.x)
    return {
      position: spec.x,
      intensity: y,
      label: spec.label,
    } as XrdProPeak
  })
}

export function toBaseOverlays(
  refs: ReferenceSpec[] | undefined,
): Array<{ name: string; x: number[]; y: number[]; color: string; width?: number; dashed?: boolean }> {
  if (!refs || refs.length === 0) return []
  return refs.map((r, i) => ({
    name: r.label,
    x: r.x,
    y: r.y,
    color: r.color ?? CHART_SERIES_PALETTE[(i + 1) % CHART_SERIES_PALETTE.length],
    width: 1.25,
    dashed: r.dashed ?? false,
  }))
}
