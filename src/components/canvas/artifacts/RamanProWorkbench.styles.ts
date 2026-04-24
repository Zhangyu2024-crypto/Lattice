// Styles hoisted from RamanProWorkbench.tsx (Phase 1 refactor). Shared
// across RamanProWorkbench.tsx + RamanProWorkbench.panel.tsx.

import type { CSSProperties } from 'react'
import { TYPO } from '../../../lib/typography-inline'

export const S = {
  errBox: { padding: 20, color: 'var(--color-red)' } as CSSProperties,
  chartWrap: {
    flex: 1,
    height: '100%',
    minHeight: 0,
    position: 'relative',
  } as CSSProperties,
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
    fontSize: TYPO.xs,
    fontFamily: 'var(--font-mono)',
  } as CSSProperties,
  matchList: {
    marginTop: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    maxHeight: 180,
    overflowY: 'auto',
  } as CSSProperties,
  matchRow: {
    display: 'grid',
    gridTemplateColumns: '1fr auto auto',
    gap: 8,
    padding: '4px 8px',
    fontSize: TYPO.xs,
    background: 'var(--color-bg-panel)',
    border: '1px solid var(--color-border)',
    borderRadius: 3,
  } as CSSProperties,
  matchName: {
    color: 'var(--color-text-primary)',
    fontWeight: 600,
  } as CSSProperties,
  matchFormula: {
    fontFamily: 'var(--font-mono)',
    fontSize: TYPO.xxs,
    color: 'var(--color-text-muted)',
  } as CSSProperties,
  matchScore: {
    fontFamily: 'var(--font-mono)',
    fontSize: TYPO.xxs,
    color: 'var(--color-accent-text)',
  } as CSSProperties,
  tabPlaceholder: {
    padding: '16px 14px',
    fontSize: TYPO.xs,
    color: 'var(--color-text-muted)',
    lineHeight: 1.5,
  } as CSSProperties,
}
