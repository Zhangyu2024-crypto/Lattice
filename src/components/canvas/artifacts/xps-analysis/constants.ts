// Chart-series color roles for the XPS analysis card. Kept isolated from
// `chart-colors` aliases so the card can tune its own palette without
// rippling into other surfaces.

import {
  CHART_PRIMARY,
  CHART_SECONDARY,
  CHART_TERTIARY,
} from '../../../../lib/chart-colors'

export const EXP_COLOR = CHART_PRIMARY
export const FIT_COLOR = CHART_SECONDARY
export const COMP_COLOR = 'rgba(176, 176, 176, 0.5)'
export const RES_COLOR = CHART_TERTIARY
