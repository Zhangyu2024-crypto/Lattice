import type { ReactNode } from 'react'

interface Props {
  /** Left-column field name. Concise — full text is fine but keep under ~14 chars. */
  label: string
  /** Right-column value. Numbers should be passed already formatted as strings. */
  value: ReactNode
  /** Render the value in monospace + tabular numerals. Use for any numeric
   *  field where alignment across rows matters. */
  mono?: boolean
  /** Tint the value with the accent text color. Use for primary identifying
   *  fields (e.g. peak label, phase name). */
  accent?: boolean
  /** Optional unit suffix rendered in muted color after the value. */
  unit?: string
}

/**
 * Two-column row used inside an inspector renderer. Each row is a single
 * label → value pairing; multi-line content (lists, JSON) should live in a
 * dedicated component, not in `value`.
 */
export default function InspectorRow({
  label,
  value,
  mono = false,
  accent = false,
  unit,
}: Props) {
  const valueClass = [
    'inspector-row-value',
    mono ? 'mono' : '',
    accent ? 'accent' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="inspector-row">
      <div className="inspector-row-label">{label}</div>
      <div className={valueClass}>
        {value}
        {unit ? <span className="inspector-row-unit">{unit}</span> : null}
      </div>
    </div>
  )
}
