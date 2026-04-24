// Small building blocks shared by every section in the ToolSidebar.
// Section wraps Disclosure with the sidebar's body padding; ToggleRow
// and SubLabel are layout atoms for checkbox rows and group labels.

import type { ReactNode } from 'react'
import { Disclosure } from '../../../../ui'
import { S } from './styles'

export function Section({
  title,
  icon,
  defaultOpen = false,
  summary,
  children,
}: {
  title: string
  icon: ReactNode
  defaultOpen?: boolean
  summary?: ReactNode
  children: ReactNode
}) {
  return (
    <Disclosure
      title={title}
      defaultOpen={defaultOpen}
      summary={summary}
      className="structure-tool-disclosure"
    >
      <div style={S.sectionBody}>{children}</div>
    </Disclosure>
  )
}

export function ToggleRow({
  label,
  active,
  onToggle,
}: {
  label: ReactNode
  active: boolean
  onToggle: () => void
}) {
  return (
    <label style={S.toggleRow}>
      <span>{label}</span>
      <input
        type="checkbox"
        checked={active}
        onChange={onToggle}
        style={S.checkbox}
      />
    </label>
  )
}

export function SubLabel({ children }: { children: ReactNode }) {
  return <div style={S.subLabel}>{children}</div>
}
