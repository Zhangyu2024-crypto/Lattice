interface Props {
  value: number | ''
  onChange: (v: number | '') => void
  min?: number
  max?: number
  step?: number
  placeholder?: string
  width?: number | string
}

export default function ProNumber({
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
  width = 80,
}: Props) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => {
        const v = e.target.value
        if (v === '') return onChange('')
        const n = Number(v)
        if (Number.isFinite(n)) onChange(n)
      }}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      className="pro-number-input"
      style={{ width: typeof width === 'number' ? `${width}px` : width }}
    />
  )
}
