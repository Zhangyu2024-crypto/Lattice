// Styles hoisted from XrdProWorkbench.tsx (Phase 1 refactor). Consumers are
// XrdProWorkbench.tsx + XrdProWorkbench.panel.tsx. Quality-card styling
// used to live here (qualityRow / qualityGrade / qualityStat / issueLine);
// it now lives inside `ProQualityCard` so XPS / Raman reuse the same look.

import type { CSSProperties } from 'react'
import type { ProDataQuality } from '../../../types/artifact'
import { TYPO } from '../../../lib/typography-inline'

type GradeStyleFn = (g: ProDataQuality['grade']) => CSSProperties

export const S = {
  errBox: {
    padding: 20,
    color: 'var(--color-red)',
  } as CSSProperties,
  left: {
    flex: 1,
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    minWidth: 0,
  } as CSSProperties,
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
  chipCount: {
    marginLeft: 4,
    padding: '0 6px',
    fontSize: TYPO['2xs'],
    background: 'var(--color-accent)',
    color: '#fff',
    borderRadius: 4,
    fontWeight: 600,
  } as CSSProperties,
  peakTableWrap: {
    marginTop: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  } as CSSProperties,
  peakTableHdr: {
    display: 'flex',
    alignItems: 'center',
    fontSize: TYPO.xxs,
    color: 'var(--color-text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  } as CSSProperties,
  peakScroll: {
    maxHeight: 200,
    overflowY: 'auto',
    border: '1px solid var(--color-border)',
    borderRadius: 3,
    background: 'var(--color-bg-panel)',
  } as CSSProperties,
  peakRow: {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
    padding: '3px 6px',
    fontFamily: 'var(--font-mono)',
    fontSize: TYPO.xs,
    borderBottom: '1px solid var(--color-border)',
  } as CSSProperties,
  peakIdx: {
    flex: '0 0 24px',
    color: 'var(--color-text-muted)',
  } as CSSProperties,
  peakCell: {
    flex: 1,
    textAlign: 'right',
    color: 'var(--color-text-primary)',
  } as CSSProperties,
  peakDelBtn: {
    flex: '0 0 auto',
    background: 'transparent',
    border: 'none',
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
    padding: 2,
  } as CSSProperties,
  peakMore: {
    padding: 4,
    fontSize: TYPO.xxs,
    textAlign: 'center',
    color: 'var(--color-text-muted)',
  } as CSSProperties,
  manualAddRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  } as CSSProperties,
  subHeader: {
    fontSize: TYPO.xxs,
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--color-text-secondary)',
    marginBottom: 4,
  } as CSSProperties,
  cifRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 8px',
    background: 'var(--color-bg-panel)',
    border: '1px solid var(--color-border)',
    borderRadius: 3,
  } as CSSProperties,
  cifName: {
    fontSize: TYPO.xs,
    fontFamily: 'var(--font-mono)',
    color: 'var(--color-text-primary)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  } as CSSProperties,
  cifMeta: {
    fontSize: TYPO.xxs,
    color: 'var(--color-text-muted)',
  } as CSSProperties,
  cifDelBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--color-red)',
    cursor: 'pointer',
    padding: 2,
  } as CSSProperties,
  candidateList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    maxHeight: 180,
    overflowY: 'auto',
  } as CSSProperties,
  candidateRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 8px',
    fontSize: TYPO.xs,
    background: 'transparent',
    border: '1px solid transparent',
    borderRadius: 3,
    cursor: 'pointer',
    color: 'var(--color-text-secondary)',
    fontFamily: 'inherit',
    textAlign: 'left',
  } as CSSProperties,
  candidateRowActive: {
    background: 'var(--color-bg-active)',
    borderColor: 'var(--color-accent)',
    color: 'var(--color-text-active)',
  } as CSSProperties,
  candidateIcon: {
    width: 12,
    display: 'flex',
    justifyContent: 'center',
  } as CSSProperties,
  candidateName: {
    flex: 1,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  } as CSSProperties,
  candidateSg: {
    fontFamily: 'var(--font-mono)',
    fontSize: TYPO.xxs,
    color: 'var(--color-text-muted)',
  } as CSSProperties,
  candidateScore: {
    fontFamily: 'var(--font-mono)',
    fontSize: TYPO.xxs,
    color: 'var(--color-accent-text)',
  } as CSSProperties,
  presetBar: {
    display: 'flex',
    gap: 4,
    marginBottom: 6,
    flexWrap: 'wrap',
  } as CSSProperties,
  presetChip: {
    padding: '3px 10px',
    fontSize: TYPO.xxs,
    background: 'var(--color-bg-panel)',
    border: '1px solid var(--color-border)',
    borderRadius: 4,
    color: 'var(--color-text-secondary)',
    cursor: 'pointer',
    fontFamily: 'inherit',
  } as CSSProperties,
  checkLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: TYPO.xs,
    color: 'var(--color-text-secondary)',
    cursor: 'pointer',
  } as CSSProperties,
  scherrerTable: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    marginTop: 4,
  } as CSSProperties,
  scherrerHead: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    fontSize: TYPO.xxs,
    color: 'var(--color-text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    padding: '4px 8px',
    borderBottom: '1px solid var(--color-border)',
  } as CSSProperties,
  scherrerRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    fontSize: TYPO.xxs,
    fontFamily: 'var(--font-mono)',
    padding: '3px 8px',
  } as CSSProperties,
  refineView: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  } as CSSProperties,
  refineStats: {
    display: 'flex',
    gap: 12,
    padding: 8,
    background: 'var(--color-bg-panel)',
    border: '1px solid var(--color-border)',
    borderRadius: 4,
  } as CSSProperties,
  refineStat: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  } as CSSProperties,
  refineStatLabel: {
    fontSize: TYPO['2xs'],
    color: 'var(--color-text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  } as CSSProperties,
  refineStatValue: {
    fontSize: TYPO.base,
    fontFamily: 'var(--font-mono)',
    fontWeight: 600,
    color: 'var(--color-accent-text)',
  } as CSSProperties,
  refinePhase: {
    padding: '6px 10px',
    background: 'var(--color-bg-panel)',
    borderLeft: '2px solid var(--color-accent)',
    borderRadius: 2,
  } as CSSProperties,
  refinePhaseName: {
    fontSize: TYPO.sm,
    fontWeight: 600,
    color: 'var(--color-text-primary)',
  } as CSSProperties,
  refinePhaseMeta: {
    fontSize: TYPO.xxs,
    color: 'var(--color-text-muted)',
    fontFamily: 'var(--font-mono)',
    marginTop: 2,
  } as CSSProperties,

  // ─── Data-tab content (W1) ────────────────────────────────────────
  tabPlaceholder: {
    padding: '16px 14px',
    fontSize: TYPO.xs,
    color: 'var(--color-text-muted)',
    lineHeight: 1.5,
  } as CSSProperties,
  tabTable: {
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    padding: '4px 0',
  } as CSSProperties,
  tabTableHead: {
    display: 'grid',
    gridTemplateColumns: '40px 1fr 1fr 1fr 1fr 22px',
    gap: 6,
    padding: '6px 12px',
    fontSize: TYPO['2xs'],
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: 'var(--color-text-muted)',
    borderBottom: '1px solid var(--color-border)',
    position: 'sticky',
    top: 0,
    background: 'var(--color-bg-panel)',
    zIndex: 1,
  } as CSSProperties,
  tabTableRow: {
    display: 'grid',
    gridTemplateColumns: '40px 1fr 1fr 1fr 1fr 22px',
    gap: 6,
    padding: '4px 12px',
    fontSize: TYPO.xs,
    fontFamily: 'var(--font-mono)',
    color: 'var(--color-text-primary)',
    alignItems: 'center',
    borderBottom: '1px solid var(--color-border)',
  } as CSSProperties,
  tabRowDelBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
    fontFamily: 'var(--font-mono)',
    fontSize: TYPO.md,
    padding: 0,
  } as CSSProperties,
  tabKvRow: {
    display: 'flex',
    gap: 10,
    padding: '5px 14px',
    fontSize: TYPO.xs,
    borderBottom: '1px solid var(--color-border)',
  } as CSSProperties,
  tabKvKey: {
    flex: '0 0 160px',
    color: 'var(--color-text-muted)',
    fontSize: TYPO.xxs,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  } as CSSProperties,
  tabKvVal: {
    flex: 1,
    fontFamily: 'var(--font-mono)',
    color: 'var(--color-text-primary)',
  } as CSSProperties,
}

// Legacy re-export kept for callers that still referenced the grade
// style factory before ProQualityCard took over the quality readout.
// Safe to remove once Phase 1 dust settles.
export const gradeStyle: GradeStyleFn = (g) => ({
  padding: '3px 10px',
  borderRadius: 4,
  fontWeight: 600,
  fontSize: TYPO.xxs,
  letterSpacing: '0.06em',
  border: '1px solid',
  borderColor:
    g === 'good'
      ? 'color-mix(in srgb, var(--color-green) 45%, transparent)'
      : g === 'fair'
        ? 'color-mix(in srgb, var(--color-yellow) 45%, transparent)'
        : 'color-mix(in srgb, var(--color-red) 45%, transparent)',
  color:
    g === 'good'
      ? 'var(--color-green)'
      : g === 'fair'
        ? 'var(--color-yellow)'
        : 'var(--color-red)',
  background:
    g === 'good'
      ? 'color-mix(in srgb, var(--color-green) 12%, transparent)'
      : g === 'fair'
        ? 'color-mix(in srgb, var(--color-yellow) 12%, transparent)'
        : 'color-mix(in srgb, var(--color-red) 12%, transparent)',
})
