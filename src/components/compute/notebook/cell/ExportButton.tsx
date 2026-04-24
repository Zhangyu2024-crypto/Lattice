// Export ▾ popover for CIF / LAMMPS cell / CP2K cell — extracted from
// ComputeCellView. Owns its own outside-click dismissal; `open` is
// lifted into the parent so the popover can close after a pick.

import { useRef } from 'react'
import { Atom, FileDown } from 'lucide-react'
import { useOutsideClickDismiss } from '../../../../hooks/useOutsideClickDismiss'

export function ExportButton({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (kind: 'cif' | 'lammps' | 'cp2k') => void
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  useOutsideClickDismiss(wrapRef, open, () => onOpenChange(false))

  const fire = (kind: 'cif' | 'lammps' | 'cp2k') => () => {
    onOpenChange(false)
    onPick(kind)
  }

  return (
    <div
      className="compute-nb-export-wrap"
      ref={wrapRef}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="session-mini-btn"
        onClick={(e) => {
          e.stopPropagation()
          onOpenChange(!open)
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Export · CIF / LAMMPS cell / CP2K cell"
        aria-label="Export structure"
      >
        <FileDown size={12} aria-hidden />
      </button>
      {open && (
        <div
          className="compute-nb-export-menu"
          role="menu"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className="compute-nb-export-item"
            onClick={fire('cif')}
          >
            <FileDown size={12} aria-hidden />
            <span>Save CIF file</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="compute-nb-export-item"
            onClick={fire('lammps')}
          >
            <Atom size={12} aria-hidden />
            <span>→ LAMMPS cell</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="compute-nb-export-item"
            onClick={fire('cp2k')}
          >
            <Atom size={12} aria-hidden />
            <span>→ CP2K cell</span>
          </button>
        </div>
      )}
    </div>
  )
}
