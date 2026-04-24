// PlotSeries / PlotReference → ECharts series object converters.

import type { PlotReference, PlotSeries } from '../../types/artifact'
import { DEFAULT_COLORS, type SeriesStyle } from './types'

export function toLineSeries(
  series: PlotSeries,
  style: SeriesStyle,
): Record<string, unknown> {
  return {
    type: 'line' as const,
    name: series.label,
    data: series.x.map((xv, i) => [xv, series.y[i] ?? 0]),
    showSymbol: false,
    sampling: 'lttb' as const,
    lineStyle: {
      color: style.color,
      width: style.width,
      type: style.dashed ? ('dashed' as const) : ('solid' as const),
    },
    emphasis: { focus: 'series' as const },
  }
}

export function toReferenceSeries(
  ref: PlotReference,
  idx: number,
): Record<string, unknown> {
  const color = ref.color ?? DEFAULT_COLORS[(idx + 4) % DEFAULT_COLORS.length]
  return {
    type: 'line' as const,
    name: ref.label,
    data: ref.x.map((xv, i) => [xv, ref.y[i] ?? 0]),
    showSymbol: false,
    sampling: 'lttb' as const,
    lineStyle: {
      color,
      width: 1.1,
      type: ref.dashed === false ? ('solid' as const) : ('dashed' as const),
    },
    z: 2,
  }
}
