// Style / axis / peak-marker helpers shared by the single-grid and
// stacked option builders.

import type { PlotPeak, PlotSeries } from '../../types/artifact'
import { DEFAULT_COLORS, type SeriesStyle } from './types'

export function pickColor(series: PlotSeries, idx: number): string {
  return series.color ?? DEFAULT_COLORS[idx % DEFAULT_COLORS.length]
}

export function seriesStyle(series: PlotSeries, idx: number): SeriesStyle {
  return {
    color: pickColor(series, idx),
    width: 1.4,
    dashed: series.dashed,
  }
}

export function maxAbsY(series: PlotSeries): number {
  let m = 0
  for (const v of series.y) {
    const abs = Math.abs(v)
    if (abs > m) m = abs
  }
  return m
}

export function peakMarkLine(peaks: ReadonlyArray<PlotPeak>) {
  if (peaks.length === 0) return undefined
  return {
    silent: true,
    symbol: 'none' as const,
    lineStyle: {
      type: 'dashed' as const,
      color: '#808080',
      width: 1,
      opacity: 0.7,
    },
    label: {
      show: true,
      position: 'end' as const,
      color: '#C8C8C8',
      fontSize: 10,
      formatter: (p: { data?: { name?: string } }) => p.data?.name ?? '',
    },
    data: peaks.map((p) => ({
      xAxis: p.x,
      name: p.label ?? '',
    })),
  }
}

export function baseAxisStyle(fontSize: number) {
  return {
    axisLabel: { color: '#9BA1A6', fontSize },
    axisLine: { lineStyle: { color: '#2A2A2A' } },
    axisTick: { lineStyle: { color: '#2A2A2A' } },
    splitLine: { show: false },
    nameTextStyle: { color: '#C8C8C8', fontSize },
  }
}
