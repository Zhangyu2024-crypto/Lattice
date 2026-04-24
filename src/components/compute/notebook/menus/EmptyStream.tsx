// Empty-state block shown when the notebook has no cells yet.
// Offers a card-grid version of NEW_CELL_OPTIONS plus a nudge to
// use Cmd+K for the Ask AI dock.

import { Sparkles } from 'lucide-react'
import type { ComputeCellKind } from '../../../../types/artifact'
import { NEW_CELL_OPTIONS } from './NewCellMenu'

export function EmptyStream({
  onCreate,
  onAction,
}: {
  onCreate: (kind: ComputeCellKind) => void
  onAction: (actionId: 'add-structure') => void
}) {
  return (
    <div className="compute-nb-empty-stream">
      <Sparkles size={22} strokeWidth={1.2} aria-hidden />
      <h2 className="compute-nb-empty-title">New Compute session</h2>
      <p className="compute-nb-empty-body">
        Create a cell to write and run scripts, or describe a structure you
        want to build. Press <kbd>⌘K</kbd> any time to ask the assistant.
      </p>
      <div className="compute-nb-empty-grid">
        {NEW_CELL_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className="compute-nb-empty-card"
            onClick={() =>
              opt.type === 'cell' ? onCreate(opt.kind) : onAction(opt.actionId)
            }
          >
            <span className={`compute-nb-kind-chip is-${opt.id}`}>
              {opt.label}
            </span>
            <span className="compute-nb-empty-hint">{opt.hint}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
