// Dropdown that surfaces matching slash commands while the user types `/…`.
//
// Purely presentational — the composer owns open/query/selectedIdx state
// and keyboard routing, mirroring the split used by `MentionPicker`. That
// keeps this component cheap to mount/unmount and trivially testable.

import { useLayoutEffect, useRef } from 'react'
import type { Command } from '../../lib/slash-commands'

interface Props {
  open: boolean
  matches: Command[]
  selectedIdx: number
  onHover: (idx: number) => void
  onSelect: (cmd: Command) => void
}

const MAX_VISIBLE = 8

export default function SlashTypeahead({
  open,
  matches,
  selectedIdx,
  onHover,
  onSelect,
}: Props) {
  const rowRefs = useRef<Array<HTMLDivElement | null>>([])

  // Keep the selected row in view when the user navigates with arrow keys.
  useLayoutEffect(() => {
    if (!open) return
    const row = rowRefs.current[selectedIdx]
    row?.scrollIntoView({ block: 'nearest' })
  }, [open, selectedIdx])

  if (!open || matches.length === 0) return null

  const visible = matches.slice(0, MAX_VISIBLE)

  return (
    <div
      className="slash-typeahead"
      role="listbox"
      aria-label="Slash command suggestions"
      style={{
        position: 'absolute',
        bottom: 'calc(100% + 4px)',
        left: 0,
        right: 0,
        maxHeight: 260,
        overflowY: 'auto',
        background: 'var(--panel-bg, #1a1a1a)',
        border: '1px solid var(--panel-border, rgba(255,255,255,0.1))',
        borderRadius: 6,
        padding: '4px 0',
        zIndex: 40,
        fontSize: 12,
      }}
    >
      {visible.map((cmd, idx) => {
        const active = idx === selectedIdx
        return (
          <div
            key={cmd.name}
            ref={(el) => {
              rowRefs.current[idx] = el
            }}
            role="option"
            aria-selected={active}
            onMouseDown={(e) => {
              // Prevent the textarea from losing focus on click.
              e.preventDefault()
              onSelect(cmd)
            }}
            onMouseEnter={() => onHover(idx)}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
              padding: '6px 10px',
              cursor: 'pointer',
              background: active
                ? 'var(--row-hover, rgba(255,255,255,0.06))'
                : 'transparent',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontWeight: 500,
                minWidth: 120,
              }}
            >
              /{cmd.name}
              {cmd.argumentHint ? (
                <span style={{ opacity: 0.5, marginLeft: 4 }}>
                  {cmd.argumentHint}
                </span>
              ) : null}
            </span>
            <span style={{ opacity: 0.7, flex: 1 }}>{cmd.description}</span>
          </div>
        )
      })}
      {matches.length > MAX_VISIBLE ? (
        <div
          style={{
            padding: '4px 10px',
            opacity: 0.5,
            fontStyle: 'italic',
          }}
        >
          +{matches.length - MAX_VISIBLE} more — keep typing to narrow
        </div>
      ) : null}
    </div>
  )
}
