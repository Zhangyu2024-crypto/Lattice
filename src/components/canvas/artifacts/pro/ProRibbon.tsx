import type { CSSProperties, ReactNode } from 'react'
import { PRO_TOOLBAR_HEIGHT } from './tokens'
import { TYPO } from '../../../../lib/typography-inline'

interface Props {
  kindLabel: string // 'XRD' / 'XPS' / 'Raman'
  title?: string
  /** Optional tag surfaced in the ribbon — e.g. "Run-04*" when a run is
   *  dirty, "pinned" when a saved run is focused. W4 wires this up. */
  runTag?: string
  onOpenCommandPalette?: () => void
  /** Additional right-side content (legacy action buttons, export etc.).
   *  Rendered between the tag and the palette trigger. */
  right?: ReactNode
  /** Optional ReactNode slotted LEFT of the kind chip. UnifiedProWorkbench
   *  uses this for the technique switcher; legacy callers leave it unset
   *  and the ribbon still shows the static kind chip. */
  leftSlot?: ReactNode
}

export default function ProRibbon({
  kindLabel,
  title,
  runTag,
  right,
  leftSlot,
}: Props) {
  return (
    <div style={S.root}>
      {leftSlot}
      <span style={S.kindChip}>{kindLabel}</span>
      {title && (
        <span style={S.title} title={title}>
          {title}
        </span>
      )}
      {runTag && <span style={S.runTag}>{runTag}</span>}
      <span className="pro-ribbon-spacer" />
      {right}
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  root: {
    height: PRO_TOOLBAR_HEIGHT,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '0 12px',
    fontSize: TYPO.sm,
    fontFamily: 'inherit',
    minWidth: 0,
  },
  kindChip: {
    padding: '2px 8px',
    borderRadius: 3,
    fontSize: TYPO.xxs,
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    background: 'var(--color-bg-active)',
    color: 'var(--color-accent-text, var(--color-accent))',
    flexShrink: 0,
  },
  title: {
    fontFamily: 'var(--font-mono)',
    color: 'var(--color-text-primary)',
    fontSize: TYPO.xs,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
  },
  runTag: {
    fontSize: TYPO.xxs,
    padding: '2px 6px',
    borderRadius: 3,
    background: 'var(--color-bg-active)',
    color: 'var(--color-text-muted)',
    fontFamily: 'var(--font-mono)',
    flexShrink: 0,
  },
}
