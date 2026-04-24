// "Used in" back-link row shown beneath the three-pane shell when any
// compute cell in the active session has this structure as its
// parentStructureId. Clicking a pill jumps to the corresponding cell
// in the compute overlay.

import { openComputeOverlay } from '../../../../lib/compute-overlay-bus'
import type { CellUsingStructure } from '../../../../stores/runtime-store'

interface Props {
  cells: CellUsingStructure[]
}

export default function UsedInRow({ cells }: Props) {
  if (cells.length === 0) return null
  return (
    <div className="card-structure-transforms-row">
      <span className="card-structure-transforms-label">
        Used in ({cells.length})
      </span>
      <div className="card-structure-transforms-list">
        {cells.map((entry) => {
          const label =
            entry.cellTitle ||
            (entry.operation
              ? entry.operation.replace(/^simulate:/, '')
              : entry.cellKind)
          return (
            <button
              key={`${entry.computeArtifactId}-${entry.cellId}`}
              type="button"
              className="card-structure-transform-pill"
              onClick={() =>
                openComputeOverlay({ focusCellId: entry.cellId })
              }
              title={`Jump to ${label} in ${entry.computeArtifactTitle}`}
            >
              <span className="card-structure-glyph">↗</span>
              <span className="card-structure-t-kind">{label}</span>
              <span className="card-structure-t-note">{entry.cellKind}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
