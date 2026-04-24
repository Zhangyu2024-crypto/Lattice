import type { CSSProperties, ReactNode } from 'react'
import { TYPO } from '../../../lib/typography-inline'

// label-ctl-unit horizontal row matching pro.html `.row`.

interface Props {
  label: string
  children: ReactNode
  unit?: string
  title?: string
}

export default function ProRow({ label, children, unit, title }: Props) {
  return (
    <div style={S.row} title={title}>
      <span style={S.label}>{label}</span>
      <div style={S.ctl}>
        {children}
        {unit && <span style={S.unit}>{unit}</span>}
      </div>
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    minHeight: 24,
    fontSize: TYPO.xs,
  },
  label: {
    flex: '0 0 88px',
    color: 'var(--color-text-secondary)',
    fontWeight: 500,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  ctl: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  unit: {
    color: 'var(--color-text-muted)',
    fontSize: TYPO.xxs,
    fontFamily: 'var(--font-mono)',
    whiteSpace: 'nowrap',
  },
}
