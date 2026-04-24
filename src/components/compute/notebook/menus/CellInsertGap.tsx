// Hoverable "+" gap between two stream cells. Clicking the button
// opens a mini menu with the same NEW_CELL_OPTIONS entries as the
// topbar "+ New cell" dropdown; the picked cell is spliced in at this
// position rather than appended to the end.

import { useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { useOutsideClickDismiss } from '../../../../hooks/useOutsideClickDismiss'
import type { ComputeCellKind } from '../../../../types/artifact'
import { NEW_CELL_OPTIONS } from './NewCellMenu'

/** Hover-reveal insert gap between two cells. Click the "+" to pick a
 *  kind; the new cell is spliced at `this position` rather than appended
 *  to the end, so adding a cell between #5 and #6 doesn't require
 *  scrolling + drag (drag isn't wired). */
export function CellInsertGap({
  onPick,
  onAction,
  disabled,
}: {
  onPick: (kind: ComputeCellKind) => void
  onAction: (actionId: 'add-structure') => void
  disabled?: boolean
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  useOutsideClickDismiss(wrapRef, menuOpen, () => setMenuOpen(false))

  return (
    <div
      ref={wrapRef}
      className={`compute-nb-cell-gap${menuOpen ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}`}
    >
      <span className="compute-nb-cell-gap-line" aria-hidden />
      <button
        type="button"
        className="compute-nb-cell-gap-btn"
        onClick={(e) => {
          e.stopPropagation()
          if (disabled) return
          setMenuOpen((v) => !v)
        }}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label="Insert cell here"
        title="Insert cell here"
      >
        <Plus size={12} aria-hidden />
      </button>
      <span className="compute-nb-cell-gap-line" aria-hidden />
      {menuOpen && (
        <div
          className="compute-nb-cell-gap-menu"
          role="menu"
          onClick={(e) => e.stopPropagation()}
        >
          {NEW_CELL_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="menuitem"
              className="compute-nb-newcell-item"
              onClick={() => {
                if (opt.type === 'cell') onPick(opt.kind)
                else onAction(opt.actionId)
                setMenuOpen(false)
              }}
            >
              <span className={`compute-nb-kind-chip is-${opt.id}`}>
                {opt.label}
              </span>
              <span className="compute-nb-newcell-hint">{opt.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
