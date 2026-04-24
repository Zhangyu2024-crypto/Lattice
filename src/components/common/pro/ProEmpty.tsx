import type { ReactNode } from 'react'

// Inline empty-state / helper text used inside Pro sections and result panes.

interface Props {
  children: ReactNode
  compact?: boolean
}

export default function ProEmpty({ children, compact = false }: Props) {
  return (
    <div className={'pro-empty' + (compact ? ' is-compact' : '')}>
      {children}
    </div>
  )
}
