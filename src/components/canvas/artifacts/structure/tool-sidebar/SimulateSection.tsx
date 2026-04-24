// Structure → Compute pipeline entries. Each button spawns a prefilled
// Compute cell targeting this structure via `load_structure('<slug>')`.
// The parent card owns the cell-creation side effect; we only raise
// the intent.

import { Activity, FlaskConical, Play, Sparkles } from 'lucide-react'
import { Section } from './primitives'
import { S } from './styles'

interface Props {
  onSimulateAction: (kind: 'md-ase' | 'dft-cp2k' | 'py-play') => void
}

export default function SimulateSection({ onSimulateAction }: Props) {
  return (
    <Section title="Simulate" icon={<Activity size={11} />}>
      <div style={S.optionGroup}>
        <button
          type="button"
          className="structure-tool-link"
          onClick={() => onSimulateAction('md-ase')}
          title="Spawn a Compute Python cell that runs an ASE + LJ Langevin MD on this structure"
        >
          <Play size={11} />
          Relax / MD (ASE + LJ)
        </button>
        <button
          type="button"
          className="structure-tool-link"
          onClick={() => onSimulateAction('dft-cp2k')}
          title="Spawn a Compute Python cell that runs a CP2K single-point via pymatgen"
        >
          <FlaskConical size={11} />
          DFT (CP2K via pymatgen)
        </button>
        <button
          type="button"
          className="structure-tool-link"
          onClick={() => onSimulateAction('py-play')}
          title="Spawn a Python playground cell seeded with load_structure(…)"
        >
          <Sparkles size={11} />
          Python playground
        </button>
      </div>
    </Section>
  )
}
