// Measure-mode toggle + distance/angle buffer hint + clear button.
// Summary surfaces "N saved" when measurements exist, else the live
// "x/3" buffer counter while measure mode is active.

import { Target } from 'lucide-react'
import { Section, ToggleRow } from './primitives'
import { S } from './styles'

interface Props {
  measureMode: boolean
  onToggleMeasureMode: () => void
  onClearMeasurements: () => void
  measurementCount: number
  selectionBufferCount: number
}

export default function MeasureSection({
  measureMode,
  onToggleMeasureMode,
  onClearMeasurements,
  measurementCount,
  selectionBufferCount,
}: Props) {
  return (
    <Section
      title="Measure"
      icon={<Target size={11} />}
      summary={
        measurementCount > 0
          ? `${measurementCount} saved`
          : measureMode
            ? `${selectionBufferCount}/3`
            : undefined
      }
    >
      <ToggleRow
        label="Measure mode"
        active={measureMode}
        onToggle={onToggleMeasureMode}
      />
      {measureMode && (
        <p style={S.help}>
          Click two atoms for distance, three for angle. Buffer:{' '}
          {selectionBufferCount}/3.
        </p>
      )}
      <button
        type="button"
        className={`structure-tool-link${
          measurementCount === 0 ? ' is-disabled' : ''
        }`}
        onClick={onClearMeasurements}
        disabled={measurementCount === 0}
      >
        Clear ({measurementCount})
      </button>
    </Section>
  )
}
