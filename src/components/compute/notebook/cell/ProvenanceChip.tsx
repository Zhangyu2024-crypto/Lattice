// "← from #N / from structure X" chip shown in the cell header — extracted
// from ComputeCellView. Clicking jumps back to the parent cell or
// structure artifact that produced this cell.

import { ArrowLeft } from 'lucide-react'
import type { ComputeCellProvenance } from '../../../../types/artifact'

export function ProvenanceChip({
  provenance,
  onJumpToParent,
  onJumpToStructure,
}: {
  provenance: ComputeCellProvenance
  onJumpToParent?: (id: string) => void
  onJumpToStructure?: (structureId: string) => void
}) {
  const hasParentCell = !!provenance.parentCellId
  const hasParentStructure = !!provenance.parentStructureId
  const label = hasParentCell
    ? `from cell ${provenance.parentCellId!.slice(-6)}`
    : hasParentStructure
      ? 'from structure'
      : provenance.prompt
        ? 'prompt'
        : provenance.operation
          ? provenance.operation
          : 'provenance'
  const title = [
    provenance.prompt ? `Prompt: ${provenance.prompt}` : null,
    provenance.operation ? `Operation: ${provenance.operation}` : null,
    provenance.parentCellId ? `Parent cell: ${provenance.parentCellId}` : null,
    provenance.parentStructureId
      ? `Parent structure: ${provenance.parentStructureId} — click to jump`
      : null,
  ]
    .filter(Boolean)
    .join('\n')
  const clickable =
    (hasParentCell && !!onJumpToParent) ||
    (hasParentStructure && !!onJumpToStructure)
  return (
    <button
      type="button"
      className={
        'compute-nb-provenance-chip' + (clickable ? ' is-clickable' : '')
      }
      onClick={(e) => {
        e.stopPropagation()
        if (hasParentCell && onJumpToParent) {
          onJumpToParent(provenance.parentCellId!)
        } else if (hasParentStructure && onJumpToStructure) {
          onJumpToStructure(provenance.parentStructureId!)
        }
      }}
      disabled={!clickable}
      title={title}
    >
      <ArrowLeft size={10} aria-hidden />
      {label}
    </button>
  )
}
