import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

export function CollapsibleSidebarHero({
  defaultOpen = true,
  titleRow,
  children,
}: {
  defaultOpen?: boolean
  titleRow: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <>
      <button
        type="button"
        className="sidebar-space-collapsible-trigger"
        aria-expanded={open}
        title={open ? 'Collapse section' : 'Expand section'}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronDown
          size={16}
          strokeWidth={1.75}
          className={[
            'sidebar-space-collapsible-chevron',
            open ? '' : 'is-collapsed',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-hidden
        />
        {titleRow}
      </button>
      {open ? children : null}
    </>
  )
}

export function CollapsibleSidebarSpaceSection({
  defaultOpen = true,
  title,
  empty,
  end,
  children,
}: {
  defaultOpen?: boolean
  title: ReactNode
  empty?: string
  /** Optional controls on the right of the section header (e.g. tabs). */
  end?: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const items = Array.isArray(children) ? children : [children]
  const hasContent = items.some(Boolean)

  const body =
    empty !== undefined ? (
      hasContent ? (
        children
      ) : (
        <div className="sidebar-space-empty">{empty}</div>
      )
    ) : (
      children
    )

  return (
    <section className="sidebar-space-section">
      <div className="sidebar-space-section-head">
        <button
          type="button"
          className="sidebar-space-collapsible-trigger sidebar-space-collapsible-trigger--section"
          aria-expanded={open}
          title={open ? 'Collapse section' : 'Expand section'}
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronDown
            size={16}
            strokeWidth={1.75}
            className={[
              'sidebar-space-collapsible-chevron',
              open ? '' : 'is-collapsed',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-hidden
          />
          {typeof title === 'string' ? (
            <span className="sidebar-space-section-title">{title}</span>
          ) : (
            title
          )}
        </button>
        {end}
      </div>
      {open ? <div className="sidebar-space-section-body">{body}</div> : null}
    </section>
  )
}
