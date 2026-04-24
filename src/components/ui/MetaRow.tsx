// MetaRow — label/value pair for "Details" / identifier lists inside cards.
// Replaces the private `row(label, value)` helpers that PaperArtifactCard,
// PropertyPanel, and several other places had duplicated. Uses a CSS grid
// so the label column lines up across a stack of rows.

import type { ReactNode } from 'react'

interface Props {
  label: string
  value: ReactNode
  /** Render the value column in monospaced font (e.g. DOIs, IDs, formulas). */
  mono?: boolean
  /** Tighter vertical padding for dense, nested lists. */
  dense?: boolean
  /** Extra class piped through to the outer wrapper. */
  className?: string
}

export default function MetaRow({
  label,
  value,
  mono = false,
  dense = false,
  className,
}: Props) {
  const classes = [
    'ui-meta-row',
    mono ? 'is-mono' : '',
    dense ? 'is-dense' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={classes}>
      <span className="ui-meta-row__k">{label}</span>
      <span className="ui-meta-row__v">{value}</span>
    </div>
  )
}
