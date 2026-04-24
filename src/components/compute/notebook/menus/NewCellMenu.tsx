// "+ New cell" dropdown + the shared option list that feeds it.
//
// `NEW_CELL_OPTIONS` is the single source of truth for the seven
// entries that appear in every "+ …" surface of the notebook:
//   • the topbar "+ New cell ▾" dropdown            → `NewCellMenu`
//   • the hover-reveal gap between cells            → `CellInsertGap`
//   • the empty-state grid when `cells.length === 0` → `EmptyStream`
//   • the foot-of-stream "+ New cell" creator       → `StreamFootCreator`
// Each surface renders the list differently (menu row / card / etc.)
// but shares the same discriminated-union item shape so behavior stays
// identical across them.

import type { ComputeCellKind } from '../../../../types/artifact'

/**
 * Notebook "+" menu entries. Historically each entry minted a new cell
 * of a specific kind. The Add Structure flow breaks that pattern — it
 * opens a modal that builds a standalone artifact (no cell created) —
 * so the options list is a discriminated union now:
 *   • `type: 'cell'`  → click creates a cell of `kind`
 *   • `type: 'action'` → click calls the host-provided handler
 */
export type NotebookMenuItem =
  | {
      type: 'cell'
      kind: ComputeCellKind
      label: string
      hint: string
      /** Stable key for React and for the `.compute-nb-kind-chip is-<id>`
       *  CSS class; matches the cell kind. */
      id: string
    }
  | {
      type: 'action'
      actionId: 'add-structure'
      label: string
      hint: string
      /** CSS-chip slot — reuses the structure-ai chip styling so the
       *  entry reads as the successor of the retired cell kind. */
      id: string
    }

export const NEW_CELL_OPTIONS: NotebookMenuItem[] = [
  { type: 'cell', kind: 'python', id: 'python', label: 'Python', hint: 'numpy / scipy / pymatgen' },
  { type: 'cell', kind: 'lammps', id: 'lammps', label: 'LAMMPS', hint: 'MD input deck' },
  { type: 'cell', kind: 'cp2k', id: 'cp2k', label: 'CP2K', hint: 'DFT / AIMD input' },
  // `structure-ai` used to live here as a cell kind. It has been
  // retired in favour of the lightweight Add Structure modal — the
  // action below — which produces a standalone artifact instead of
  // polluting the notebook with prompt + code + preview cell stacks.
  // Old saved notebooks with structure-ai cells still render fine via
  // the legacy path in useComputeRunner.
  {
    type: 'action',
    actionId: 'add-structure',
    id: 'structure-ai',
    label: 'Structure',
    hint: 'AI-built crystal → 3D artifact',
  },
  { type: 'cell', kind: 'structure-code', id: 'structure-code', label: 'Structure · Code', hint: 'pymatgen / ASE' },
  { type: 'cell', kind: 'shell', id: 'shell', label: 'Shell', hint: 'bash · runs in the container' },
  { type: 'cell', kind: 'markdown', id: 'markdown', label: 'Markdown', hint: 'Notes / section heading' },
]

export function NewCellMenu({
  onPick,
  onAction,
}: {
  onPick: (kind: ComputeCellKind) => void
  onAction: (actionId: 'add-structure') => void
}) {
  return (
    <div className="compute-nb-newcell-menu" role="menu">
      {NEW_CELL_OPTIONS.map((opt) => (
        <button
          key={opt.id}
          type="button"
          role="menuitem"
          className="compute-nb-newcell-item"
          onClick={() => {
            if (opt.type === 'cell') onPick(opt.kind)
            else onAction(opt.actionId)
          }}
        >
          <span className={`compute-nb-kind-chip is-${opt.id}`}>
            {opt.label}
          </span>
          <span className="compute-nb-newcell-hint">{opt.hint}</span>
        </button>
      ))}
    </div>
  )
}
