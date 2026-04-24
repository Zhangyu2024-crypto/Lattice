// Element-symbol label toggle. Kept as its own section because the
// next pass will add per-element color overrides / label sizes here.

import { Tag } from 'lucide-react'
import { Section, ToggleRow } from './primitives'

interface Props {
  showElementLabels: boolean
  onToggleElementLabels: () => void
}

export default function LabelsSection({
  showElementLabels,
  onToggleElementLabels,
}: Props) {
  return (
    <Section title="Labels" icon={<Tag size={11} />}>
      <ToggleRow
        label="Element symbols"
        active={showElementLabels}
        onToggle={onToggleElementLabels}
      />
    </Section>
  )
}
