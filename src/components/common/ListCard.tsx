// ListCard — accessible selectable row used by Library paper list and
// Knowledge chain list. Replaces the bespoke <div onClick> cards that
// had no keyboard activation or focus indicator.
//
// Shape:
//   - Renders as a plain <div role="button" tabIndex=0> because the
//     cards almost always contain nested interactive controls (Open,
//     Delete) which would nest <button>s illegally.
//   - Keyboard: Enter / Space both invoke onSelect.
//   - Trailing actions are passed separately so we can stopPropagation
//     on their click inside this component rather than forcing every
//     caller to remember it.

import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'

interface Props {
  selected?: boolean
  onSelect: () => void
  disabled?: boolean
  ariaLabel: string
  className?: string
  trailingActions?: ReactNode
  children: ReactNode
}

export default function ListCard({
  selected,
  onSelect,
  disabled,
  ariaLabel,
  className,
  trailingActions,
  children,
}: Props) {
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect()
    }
  }
  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    if (disabled) return
    // Don't bubble selection if the user clicked an interactive trailing
    // action. The trailing-actions slot also stops propagation via its
    // wrapper, but this guard covers cases where the row itself is what
    // emitted the synthetic event.
    const target = e.target as HTMLElement
    if (target.closest('[data-list-card-skip]')) return
    onSelect()
  }
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-pressed={selected ? true : undefined}
      aria-disabled={disabled || undefined}
      aria-label={ariaLabel}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={[
        'module-list-card',
        selected ? 'is-selected' : '',
        disabled ? 'is-disabled' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="module-list-card__body">{children}</div>
      {trailingActions && (
        <div
          data-list-card-skip
          className="module-list-card__actions"
          onClick={(e) => e.stopPropagation()}
        >
          {trailingActions}
        </div>
      )}
    </div>
  )
}
