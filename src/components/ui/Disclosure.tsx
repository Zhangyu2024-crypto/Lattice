// Disclosure — a labeled, keyboard-accessible section that toggles its
// body open/closed. The head is a real <button> so Enter/Space/tab all
// work without hand-rolled listeners; the chevron rotates via a CSS
// transform keyed off `aria-expanded`.
//
// Supports both uncontrolled (`defaultOpen`) and controlled
// (`open` + `onOpenChange`) modes so callers can hold the open state
// externally when a side effect (lazy-load, persistence) must fire
// on each toggle.

import { useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

interface Props {
  title: string
  /** Uncontrolled initial state. Ignored when `open` is provided. */
  defaultOpen?: boolean
  /** Controlled open state. When set, pair with `onOpenChange`. */
  open?: boolean
  /** Fires on every toggle attempt. Required when `open` is set so the
   *  consumer can commit the new state; also useful in uncontrolled mode
   *  for side effects like lazy-loading a section's contents. */
  onOpenChange?: (open: boolean) => void
  /** Optional right-aligned summary (e.g. "12 items", "3 sections"). */
  summary?: ReactNode
  /** Extra class piped through to the outer <section>. */
  className?: string
  children: ReactNode
}

export default function Disclosure({
  title,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  summary,
  className,
  children,
}: Props) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const isControlled = openProp !== undefined
  const open = isControlled ? openProp : uncontrolledOpen
  const toggle = () => {
    const next = !open
    if (!isControlled) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }
  const classes = [
    'ui-disclosure',
    open ? 'is-open' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <section className={classes}>
      <button
        type="button"
        className="ui-disclosure__head"
        aria-expanded={open}
        onClick={toggle}
      >
        <ChevronRight size={12} className="ui-disclosure__chevron" />
        <span className="ui-disclosure__title">{title}</span>
        {summary != null && (
          <span className="ui-disclosure__summary">{summary}</span>
        )}
      </button>
      {open && <div className="ui-disclosure__body">{children}</div>}
    </section>
  )
}
