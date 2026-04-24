// Tabular detail area beneath the main visualisation. W1 ships a simple
// tab bar + content region; workbenches supply tab content as plain
// ReactNodes. W3/W4 will upgrade this into richer grids (editable
// spectrum table, fit parameter watch list, etc.); for now we just put
// existing peak tables in here so users get more vertical real estate
// than the old in-section placement.

import type { CSSProperties, ReactNode } from 'react'
import { PRO_TOOLBAR_HEIGHT } from './tokens'
import { TYPO } from '../../../../lib/typography-inline'

export interface ProDataTabDef {
  id: string
  label: string
  /** Shown after the label in a small subdued pill. */
  badge?: string | number
  content: ReactNode
  /** Disabled tabs still render in the bar but can't be selected. */
  disabled?: boolean
}

interface Props {
  tabs: ProDataTabDef[]
  activeId: string
  onChange: (id: string) => void
}

export default function ProDataTabs({ tabs, activeId, onChange }: Props) {
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0]
  return (
    <div style={S.root}>
      <div role="tablist" style={S.bar}>
        {tabs.map((tab) => {
          const isActive = tab.id === activeId
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => !tab.disabled && onChange(tab.id)}
              className={`pro-data-tabs-tab${
                isActive ? ' is-active' : ''
              }${tab.disabled ? ' is-disabled' : ''}`}
              disabled={tab.disabled}
            >
              <span>{tab.label}</span>
              {tab.badge != null && (
                <span style={S.badge}>{tab.badge}</span>
              )}
            </button>
          )
        })}
      </div>
      <div style={S.content}>{active?.content}</div>
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  root: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
  },
  bar: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'flex-end',
    gap: 2,
    padding: '0 8px',
    borderBottom: '1px solid var(--color-border)',
    background: 'var(--color-bg-sidebar)',
    height: PRO_TOOLBAR_HEIGHT,
  },
  badge: {
    fontSize: TYPO.xxs,
    padding: '1px 6px',
    borderRadius: 6,
    background: 'var(--color-bg-active)',
    color: 'var(--color-text-muted)',
    fontFamily: 'var(--font-mono)',
  },
  content: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'auto',
  },
}
