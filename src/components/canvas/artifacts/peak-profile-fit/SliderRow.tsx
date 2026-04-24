import { S } from './styles'

// Single labelled slider row used by the pseudo-Voigt profile fitter for
// each of the four LM parameters (centre / FWHM / η / amplitude). Kept
// intentionally dumb: numeric input only, value is read back on every
// change via `Number(e.currentTarget.value)` so the parent can drive the
// live model preview without batching.

export interface SliderRowProps {
  label: string
  unit: string
  min: number
  max: number
  step: number
  value: number
  onChange: (v: number) => void
}

export function SliderRow({
  label,
  unit,
  min,
  max,
  step,
  value,
  onChange,
}: SliderRowProps) {
  return (
    <div style={S.sliderRow}>
      <span style={S.sliderLabel}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        style={S.slider}
      />
      <span style={S.sliderValue}>{value.toFixed(3)}</span>
      {unit && <span style={S.sliderUnit}>{unit}</span>}
    </div>
  )
}
