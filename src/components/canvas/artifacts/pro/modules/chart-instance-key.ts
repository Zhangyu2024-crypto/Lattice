import type { ProWorkbenchSpectrum } from '@/types/artifact'
import { buildSeriesChartInstanceKey } from '@/lib/chart-instance-key'
import type { ChartOverlay } from './types'

/** Remount the ECharts instance when the underlying spectrum changes so
 *  stale dataZoom / viewport state from the previous trace doesn't clip
 *  the newly loaded curve. Keep the key stable for ordinary peak / param
 *  edits so in-place zooming still works within one spectrum. */
export function buildChartInstanceKey(
  spectrum: ProWorkbenchSpectrum | null,
  overlays: ChartOverlay[] = [],
): string {
  const overlayKey = overlays.map((o) => o.name).join('|')
  return buildSeriesChartInstanceKey(
    spectrum
      ? {
          x: spectrum.x,
          y: spectrum.y,
          sourceFile: spectrum.sourceFile ?? null,
          seriesType: spectrum.spectrumType ?? null,
        }
      : null,
    [overlayKey],
  )
}
