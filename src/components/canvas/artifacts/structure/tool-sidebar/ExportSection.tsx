// Native file / native-engine handoff. Distinct from Simulate: the
// intent here is grabbing artefacts another tool can consume as-is
// (.cif file on disk, runnable LAMMPS deck, complete CP2K .inp) rather
// than launching a workflow inside the app.

import { Atom, FileDown } from 'lucide-react'
import { Section } from './primitives'
import { S } from './styles'

interface Props {
  onExportAction: (kind: 'cif' | 'lammps' | 'cp2k') => void
}

export default function ExportSection({ onExportAction }: Props) {
  return (
    <Section title="Export" icon={<FileDown size={11} />}>
      <div style={S.optionGroup}>
        <button
          type="button"
          className="structure-tool-link"
          onClick={() => onExportAction('cif')}
          title="Download this structure as a standalone .cif file"
        >
          <FileDown size={11} />
          Save CIF file
        </button>
        <button
          type="button"
          className="structure-tool-link"
          onClick={() => onExportAction('lammps')}
          title="Spawn a Python cell that writes a LAMMPS data file via ASE + runs `lmp`"
        >
          <Atom size={11} />
          → LAMMPS cell
        </button>
        <button
          type="button"
          className="structure-tool-link"
          onClick={() => onExportAction('cp2k')}
          title="Spawn a native CP2K cell with a complete .inp (cell + coords inlined)"
        >
          <Atom size={11} />
          → CP2K cell
        </button>
      </div>
    </Section>
  )
}
