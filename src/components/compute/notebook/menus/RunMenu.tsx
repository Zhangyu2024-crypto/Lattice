// Run ▾ split button in the notebook topbar.
//
// The main button opens a dropdown with four actions: Run all,
// Run above focused, Run below focused, and Clear all outputs.
// "above" and "below" are disabled when no cell is focused.

import { ChevronDown, Play } from 'lucide-react'
import { useOutsideClickDismiss } from '../../../../hooks/useOutsideClickDismiss'
import type { ComputeCell } from '../../../../types/artifact'

/** Run ▾ split-button in the topbar. The main button opens the menu;
 *  the menu has three actions (all / above focused / below focused).
 *  "above" and "below" are disabled when no cell is focused. */
export function RunMenu({
  wrapRef,
  open,
  onToggle,
  onClose,
  cells,
  focusedCellId,
  disabled,
  onRun,
  onClearOutputs,
}: {
  wrapRef: React.RefObject<HTMLDivElement | null>
  open: boolean
  onToggle: () => void
  onClose: () => void
  cells: ComputeCell[]
  focusedCellId: string | null
  disabled: boolean
  onRun: (ids: string[]) => void
  onClearOutputs: () => void
}) {
  // Outside-click dismiss. Ref the entire wrap (button + menu) so clicks
  // inside the dropdown don't close it before the item's onClick fires.
  useOutsideClickDismiss(wrapRef, open, onClose)

  const focusedIdx = focusedCellId
    ? cells.findIndex((c) => c.id === focusedCellId)
    : -1
  const allIds = cells.map((c) => c.id)
  const aboveIds =
    focusedIdx > 0 ? cells.slice(0, focusedIdx).map((c) => c.id) : []
  const belowIds =
    focusedIdx >= 0 && focusedIdx < cells.length - 1
      ? cells.slice(focusedIdx + 1).map((c) => c.id)
      : []

  return (
    <div className="compute-nb-runmenu-wrap" ref={wrapRef}>
      <button
        type="button"
        className="compute-nb-run-btn"
        onClick={onToggle}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Run all · above · below"
      >
        <Play size={12} aria-hidden />
        Run
        <ChevronDown size={11} aria-hidden />
      </button>
      {open && (
        <div className="compute-nb-runmenu-menu" role="menu">
          <RunMenuItem
            label="Run all"
            sub={`${allIds.length} cells`}
            disabled={allIds.length === 0}
            onClick={() => onRun(allIds)}
          />
          <RunMenuItem
            label="Run above focused"
            sub={aboveIds.length > 0 ? `${aboveIds.length} cells` : 'none'}
            disabled={aboveIds.length === 0}
            onClick={() => onRun(aboveIds)}
          />
          <RunMenuItem
            label="Run below focused"
            sub={belowIds.length > 0 ? `${belowIds.length} cells` : 'none'}
            disabled={belowIds.length === 0}
            onClick={() => onRun(belowIds)}
          />
          <div className="compute-nb-runmenu-sep" role="separator" />
          <RunMenuItem
            label="Clear all outputs"
            sub="keep cells, wipe runs"
            disabled={cells.length === 0}
            onClick={() => {
              onClearOutputs()
              onClose()
            }}
          />
        </div>
      )}
    </div>
  )
}

function RunMenuItem({
  label,
  sub,
  disabled,
  onClick,
}: {
  label: string
  sub: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className="compute-nb-newcell-item"
      onClick={onClick}
      disabled={disabled}
    >
      <span className="compute-nb-runmenu-label">
        <Play size={11} aria-hidden />
        {label}
      </span>
      <span className="compute-nb-newcell-hint">{sub}</span>
    </button>
  )
}
