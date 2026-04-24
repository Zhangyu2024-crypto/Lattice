import { S } from './styles'

export default function SliderField({
  label,
  unit,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string
  unit: string
  min: number
  max: number
  step: number
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div style={S.sliderRow}>
      <span style={S.rowLabel}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={S.slider}
      />
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={S.numInputInline}
      />
      <span style={S.unit}>{unit}</span>
    </div>
  )
}
