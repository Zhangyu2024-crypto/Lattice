import type { CSSProperties } from 'react'

interface Option {
  value: string
  label: string
  group?: string
}

interface Props {
  value: string
  options: Option[]
  onChange: (v: string) => void
  // Caller-supplied style passthrough. Preserved for any upstream overrides
  // (e.g., width or align-self tweaks) applied by Pro workbench forms.
  style?: CSSProperties
}

export default function ProSelect({ value, options, onChange, style }: Props) {
  const groups = groupOptions(options)
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="pro-select"
      style={style}
    >
      {groups.map((g, i) =>
        g.group ? (
          <optgroup key={`g-${i}-${g.group}`} label={g.group}>
            {g.items.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ) : (
          g.items.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))
        ),
      )}
    </select>
  )
}

function groupOptions(opts: Option[]): Array<{ group?: string; items: Option[] }> {
  const out: Array<{ group?: string; items: Option[] }> = []
  for (const o of opts) {
    const last = out[out.length - 1]
    if (last && last.group === o.group) {
      last.items.push(o)
    } else {
      out.push({ group: o.group, items: [o] })
    }
  }
  return out
}
