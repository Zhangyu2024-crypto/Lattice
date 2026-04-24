// Unit-cell visibility + visual replication grid. Replication here is
// pure viewer decoration; it does NOT mutate the underlying structure
// (Build → 2×2×2 supercell does that).

import { Box } from 'lucide-react'
import type { Replication } from '../StructureViewer'
import { Section, SubLabel, ToggleRow } from './primitives'
import { REPLICATION_OPTIONS } from './constants'
import { S } from './styles'

interface Props {
  showUnitCell: boolean
  onToggleUnitCell: () => void
  replication: Replication
  onReplicationChange: (r: Replication) => void
}

export default function CellSection({
  showUnitCell,
  onToggleUnitCell,
  replication,
  onReplicationChange,
}: Props) {
  return (
    <Section
      title="Cell"
      icon={<Box size={11} />}
      summary={`${replication.nx}×${replication.ny}×${replication.nz}`}
    >
      <ToggleRow
        label="Show unit cell"
        active={showUnitCell}
        onToggle={onToggleUnitCell}
      />
      <SubLabel>Visual replication</SubLabel>
      <div style={S.optionGroup}>
        {REPLICATION_OPTIONS.map((opt) => {
          const active =
            opt.value.nx === replication.nx &&
            opt.value.ny === replication.ny &&
            opt.value.nz === replication.nz
          return (
            <button
              key={opt.label}
              type="button"
              onClick={() => onReplicationChange(opt.value)}
              className={`structure-tool-option${active ? ' is-active' : ''}`}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </Section>
  )
}
