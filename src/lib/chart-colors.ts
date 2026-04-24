/**
 * Grayscale chart palette (aligned with src/styles/tokens.css --color-chart-*).
 * ECharts and canvas code import these instead of hard-coded hues.
 */
export const CHART_PRIMARY = '#E8E8E8'
export const CHART_SECONDARY = '#B0B0B0'
export const CHART_TERTIARY = '#787878'
export const CHART_QUATERNARY = '#505050'
export const CHART_QUINARY = '#383838'

/** Multi-series line / bar cycling (distinct luminance steps). */
export const CHART_SERIES_PALETTE = [
  CHART_PRIMARY,
  CHART_SECONDARY,
  CHART_TERTIARY,
  CHART_QUATERNARY,
  CHART_QUINARY,
  '#C8C8C8',
] as const

/** Low-saturation cycle used for secondary pattern overlays (user-loaded
 *  in-situ series, candidate reference peaks, pseudo-Voigt simulations)
 *  in the Pro workbenches. Distinct from CHART_SERIES_PALETTE so primary
 *  series retain more luminance headroom above the overlay set. */
export const GRAYSCALE_OVERLAY_COLORS = [
  '#888',
  '#aaa',
  '#666',
  '#bbb',
  '#555',
  '#999',
] as const

export const CHART_AXIS_LINE = '#2A2A2A'
export const CHART_AXIS_LABEL = '#888888'
export const CHART_GRID = '#1F1F1F'
