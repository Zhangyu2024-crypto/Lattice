// Quick structure edits — supercell / dope / surface / defect — plus
// the optional "Edit CIF..." entry. Each button opens a parameter dialog
// in the parent artifact card; we just surface buttons and route through
// onTransformAction so the parent owns the modal state + REST calls.

import { Atom, Box, Edit3, Grid3x3, Wand2, Zap } from 'lucide-react'
import type { StructureTransformKind } from '../../../../../types/artifact'
import { Section } from './primitives'
import { S } from './styles'

interface Props {
  onTransformAction: (id: StructureTransformKind) => void
  onEditCif?: () => void
}

export default function BuildSection({ onTransformAction, onEditCif }: Props) {
  return (
    <Section title="Build" icon={<Wand2 size={11} />}>
      <div style={S.optionGroup}>
        <button
          type="button"
          className="structure-tool-link"
          onClick={() => onTransformAction('supercell')}
        >
          <Box size={11} />
          Supercell...
        </button>
        <button
          type="button"
          className="structure-tool-link"
          onClick={() => onTransformAction('dope')}
        >
          <Atom size={11} />
          Dope element...
        </button>
        <button
          type="button"
          className="structure-tool-link"
          onClick={() => onTransformAction('surface')}
        >
          <Grid3x3 size={11} />
          Build surface...
        </button>
        <button
          type="button"
          className="structure-tool-link"
          onClick={() => onTransformAction('defect')}
        >
          <Zap size={11} />
          Add vacancy...
        </button>
        {onEditCif && (
          <button
            type="button"
            className="structure-tool-link"
            onClick={onEditCif}
            title="Edit the CIF text directly — lattice params, atoms, occupancies, any field. Overwrites this artifact in place."
          >
            <Edit3 size={11} />
            Edit CIF...
          </button>
        )}
      </div>
    </Section>
  )
}
