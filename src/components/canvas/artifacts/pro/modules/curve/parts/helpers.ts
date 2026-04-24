// Pure helpers used by the Curve technique module. Kept free of React and
// closure state so they stay unit-testable in isolation.

import type {
  CurveFeature,
  CurveSubState,
  XrdProPeak,
} from '@/types/artifact'
import { rowsToCsv } from '@/lib/pro-export'
import type { NormalisedPeak } from '../../types'

/**
 * Build the CSV text for exporting detected features. Curve uses a generic
 * x/y axis (no unit known at this layer), so column headers are left as
 * plain `position` / `intensity` rather than technique-specific labels.
 */
export function buildFeaturesCsv(peaks: ReadonlyArray<CurveFeature>): string {
  return rowsToCsv(
    peaks.map((p, i) => ({
      index: i + 1,
      position: p.position,
      intensity: p.intensity,
      fwhm: p.fwhm ?? '',
      label: p.label ?? '',
    })),
    [
      { key: 'index', header: 'index' },
      { key: 'position', header: 'position' },
      { key: 'intensity', header: 'intensity' },
      { key: 'fwhm', header: 'fwhm' },
      { key: 'label', header: 'label' },
    ],
  )
}

/**
 * Map the module's `CurveFeature[]` into the shared `NormalisedPeak` shape
 * used by `buildSpectrumChartOption` and the generic peaks pipeline.
 *
 * `CurveFeature` lacks `snr`; `XrdProPeak` (== `NormalisedPeak`) has an
 * optional `snr`. Omitting it produces a valid `XrdProPeak` shape — the
 * shared chart option builder only reads position / intensity / fwhm.
 */
export function peaksFromSub(sub: CurveSubState): NormalisedPeak[] {
  return sub.peaks.map<XrdProPeak>((p: CurveFeature) => ({
    position: p.position,
    intensity: p.intensity,
    fwhm: p.fwhm,
  }))
}

