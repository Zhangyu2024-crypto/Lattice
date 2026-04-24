// Inline style atoms shared across the ToolSidebar sections. Lives in a
// sibling module so the entry component stays composition-only and each
// section reaches into the same S map rather than duplicating rules.

import type { CSSProperties } from 'react'
import { TYPO } from '../../../../../lib/typography-inline'

export const S: Record<string, CSSProperties> = {
  root: {
    width: '100%',
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    padding: '8px 10px',
    background: 'var(--color-bg-sidebar)',
    overflowY: 'auto',
    minHeight: 0,
  },
  section: { display: 'flex', flexDirection: 'column', gap: 6 },
  sectionBody: { display: 'flex', flexDirection: 'column', gap: 6 },
  optionGroup: { display: 'flex', flexDirection: 'column', gap: 2 },
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: TYPO.xs,
    color: 'var(--color-text-secondary)',
    cursor: 'pointer',
    padding: '3px 2px',
  },
  iconLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
  },
  checkbox: { cursor: 'pointer' },
  subLabel: {
    fontSize: TYPO['2xs'],
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: 'var(--color-text-muted)',
    marginTop: 4,
  },
  swatches: { display: 'flex', gap: 4, flexWrap: 'wrap' },
  help: {
    fontSize: TYPO.xxs,
    color: 'var(--color-text-muted)',
    margin: '4px 0',
    lineHeight: 1.4,
  },
}
