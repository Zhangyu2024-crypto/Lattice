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
  const hiddenCount = matches.length - MAX_VISIBLE

  return (
    <div
      className="slash-typeahead"
      role="listbox"
      aria-label="Slash command suggestions"
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
            className={
              'slash-typeahead-row' + (active ? ' is-active' : '')
            }
          >
            <span className="slash-typeahead-main">
              <span className="slash-typeahead-titleline">
                <span className="slash-typeahead-name">/{cmd.name}</span>
                {cmd.argumentHint ? (
                  <span className="slash-typeahead-args">
                    {cmd.argumentHint}
                  </span>
                ) : null}
              </span>
              <span className="slash-typeahead-desc">{cmd.description}</span>
            </span>
          </div>
        )
      })}
      {hiddenCount > 0 ? (
        <div className="slash-typeahead-more">
          +{hiddenCount} more · keep typing to narrow
        </div>
      ) : null}
    </div>
  )
}
