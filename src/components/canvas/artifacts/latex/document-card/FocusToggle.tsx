import type { ReactNode } from 'react'

// Slim toggle used by the focus-mode header. Distinct from `Button` because
// it carries an `active` state style, an optional count badge, and a kbd
// hint pill — too many bespoke needs to warrant new Button variants.
export function FocusToggle({
  active,
  onClick,
  icon,
  label,
  title,
  badge,
  hint,
}: {
  active: boolean
  onClick: () => void
  icon: ReactNode
  label: string
  title: string
  badge?: number
  hint?: string
}) {
  return (
    <button
      type="button"
      className={'latex-focus-toggle' + (active ? ' is-active' : '')}
      onClick={onClick}
      aria-pressed={active}
      title={title}
    >
      {icon}
      <span className="latex-focus-toggle-label">{label}</span>
      {badge != null && badge > 0 ? (
        <span className="latex-focus-toggle-badge">{badge}</span>
      ) : null}
      {hint ? <span className="latex-focus-kbd">{hint}</span> : null}
    </button>
  )
}
