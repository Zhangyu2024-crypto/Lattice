// "+ New cell" creator pinned at the very end of the cell stream.
// Acts as the always-visible counterpart to the hover-reveal
// CellInsertGap — a reliable target for appending a new cell once
// the user has scrolled past the last cell.

import { useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { useOutsideClickDismiss } from '../../../../hooks/useOutsideClickDismiss'
import type { ComputeCellKind } from '../../../../types/artifact'
import { NewCellMenu } from './NewCellMenu'

export function StreamFootCreator({
  onCreate,
  onAction,
}: {
  onCreate: (kind: ComputeCellKind) => void
  onAction: (actionId: 'add-structure') => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  useOutsideClickDismiss(wrapRef, open, () => setOpen(false))

  return (
    <div className="compute-nb-foot-creator-wrap" ref={wrapRef}>
      <button
        type="button"
        className="compute-nb-foot-creator"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Plus size={13} aria-hidden />
        New cell
      </button>
      {open && (
        <NewCellMenu
          onPick={(kind) => {
            onCreate(kind)
            setOpen(false)
          }}
          onAction={(actionId) => {
            onAction(actionId)
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}
