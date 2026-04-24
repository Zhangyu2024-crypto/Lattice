// Styles for CurveProWorkbench. Mirrors RamanProWorkbench.styles.ts so a
// designer can theme all four spectrum-pro workbenches with one file
// later.

import type { CSSProperties } from 'react'
import { TYPO } from '../../../lib/typography-inline'

export const S = {
  errBox: { padding: 20, color: 'var(--color-red)' } as CSSProperties,
  chartWrap: { flex: 1, height: '100%', minHeight: 0 } as CSSProperties,
  emptyChart: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    color: 'var(--color-text-muted)',
  } as CSSProperties,
  peakTable: {
    border: '1px solid var(--color-border)',
    borderRadius: 3,
    background: 'var(--color-bg-panel)',
    maxHeight: 200,
    overflowY: 'auto',
  } as CSSProperties,
  peakHead: {
    display: 'grid',
    gridTemplateColumns: '30px 1fr 1fr 1fr',
    padding: '4px 8px',
    fontSize: TYPO.xxs,
    color: 'var(--color-text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    borderBottom: '1px solid var(--color-border)',
  } as CSSProperties,
  peakRow: {
    display: 'grid',
    gridTemplateColumns: '30px 1fr 1fr 1fr',
    padding: '3px 8px',
    fontSize: TYPO.xxs,
    fontFamily: 'var(--font-mono)',
  } as CSSProperties,
  tabPlaceholder: {
    padding: '16px 14px',
    fontSize: TYPO.xs,
    color: 'var(--color-text-muted)',
    lineHeight: 1.5,
  } as CSSProperties,
  inspectorBlock: {
    padding: '8px 10px',
    borderBottom: '1px solid var(--color-border)',
  } as CSSProperties,
  inspectorTitle: {
    fontSize: TYPO.xxs,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: 'var(--color-text-muted)',
    marginBottom: 6,
  } as CSSProperties,
  field: {
    display: 'grid',
    gridTemplateColumns: '60px 1fr',
    alignItems: 'center',
    gap: 6,
    fontSize: TYPO.xs,
    marginBottom: 4,
  } as CSSProperties,
  inputCompact: {
    width: '100%',
    padding: '2px 6px',
    fontSize: TYPO.xs,
    background: 'var(--color-bg-base)',
    color: 'var(--color-text-primary)',
    border: '1px solid var(--color-border)',
    borderRadius: 3,
    fontFamily: 'var(--font-mono)',
  } as CSSProperties,
}
