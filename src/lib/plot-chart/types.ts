// Shared types and theme constants for the plot-chart option builder.
//
// Kept separate so helpers / series converters / the stacked builder
// can import them without pulling in ECharts specifics.

import type { PlotParams } from '../../types/artifact'

export type EChartsOption = Record<string, unknown>

export interface SeriesStyle {
  color: string
  width: number
  dashed?: boolean
}

/** Grayscale-first palette — the app design canon is dark/monochrome,
 *  so multi-series plots use a tight range of greys + one accent. When
 *  the caller sets `series.color` explicitly it wins. */
export const DEFAULT_COLORS: ReadonlyArray<string> = [
  '#E5E5E5',
  '#9BA1A6',
  '#6C7680',
  '#4A4F56',
  '#C8C8C8',
  '#808080',
  '#A8A8A8',
  '#DADADA',
]

export const JOURNAL_FONT_SIZE: Record<PlotParams['journalStyle'], number> = {
  default: 12,
  minimal: 11,
  acs: 12,
  rsc: 11,
  nature: 11,
}
