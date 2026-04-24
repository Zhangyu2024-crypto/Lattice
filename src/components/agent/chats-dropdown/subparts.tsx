// Small presentational sub-parts for ChatsDropdown. Pulled out of the
// main file so the dropdown composition itself can stay focused on
// state + wiring; these have no state of their own.

import type { ReactNode } from 'react'

export function TabButton({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean
  onClick: () => void
  count: number
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={`chats-dropdown-tab${active ? ' is-active' : ''}`}
      onClick={onClick}
    >
      {children}
      <span className="chats-dropdown-tab-count">{count}</span>
    </button>
  )
}

export function Section({
  title,
  children,
}: {
  title?: string
  children: ReactNode
}) {
  return (
    <div className="chats-dropdown-section">
      {title ? (
        <div className="chats-dropdown-section-title">{title}</div>
      ) : null}
      {children}
    </div>
  )
}
