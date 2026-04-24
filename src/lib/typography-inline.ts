/**
 * React `style.fontSize` strings bound to `tokens.css` --text-*.
 * For ECharts / canvas pixel APIs use `CHART_TEXT_PX` from `./chart-text-px`.
 */
export const TYPO = {
  micro: 'var(--text-micro)',
  '2xs': 'var(--text-2xs)',
  xxs: 'var(--text-xxs)',
  xs: 'var(--text-xs)',
  sm: 'var(--text-sm)',
  base: 'var(--text-base)',
  md: 'var(--text-md)',
  lg: 'var(--text-lg)',
  xl: 'var(--text-xl)',
  '2xl': 'var(--text-2xl)',
  '3xl': 'var(--text-3xl)',
} as const
