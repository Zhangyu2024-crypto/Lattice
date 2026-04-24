import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { TYPO } from '../../../lib/typography-inline'

interface Props {
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  format?: (v: number) => string
  /** W2: precise mode. Renders a number input beside the slider; users
   *  can type any value, including out-of-[min, max] numbers, which go
   *  straight to `onChange` (we only emit `console.warn`). Stays back-
   *  compat: default `precise={false}` is the legacy slider-only widget.
   *  For a Pro Workbench knob, call sites pass `precise` so advanced
   *  users aren't boxed into suggested ranges. */
  precise?: boolean
  /** Optional label surfaced next to the numeric input — short units or
   *  the parameter name, shown in `precise` mode only. */
  label?: string
}

export default function ProSlider({
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  precise = false,
  label,
}: Props) {
  const display = format ? format(value) : formatDefault(value, step)

  if (!precise) {
    return (
      <>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={S.range}
        />
        <span style={S.val}>{display}</span>
      </>
    )
  }

  return (
    <PreciseSlider
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={onChange}
      label={label}
    />
  )
}

function PreciseSlider({
  value,
  min,
  max,
  step,
  onChange,
  label,
}: {
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  label?: string
}) {
  // Local draft so users can type freely — commit on blur or Enter.
  const [draft, setDraft] = useState(formatDefault(value, step))
  // When the store value changes (reset, preset, etc.) resync the draft.
  const lastValueRef = useRef(value)
  useEffect(() => {
    if (value !== lastValueRef.current) {
      setDraft(formatDefault(value, step))
      lastValueRef.current = value
    }
  }, [value, step])

  const commit = (raw: string): void => {
    const trimmed = raw.trim()
    if (trimmed === '' || trimmed === '-' || trimmed === '.') {
      // Reset to stored value on empty / partial input.
      setDraft(formatDefault(value, step))
      return
    }
    const n = Number(trimmed)
    if (!Number.isFinite(n)) {
      setDraft(formatDefault(value, step))
      return
    }
    if (n < min || n > max) {
      // Pro-mode: out-of-range is a warning, not a rejection. Advanced
      // users may need a `tolerance=5` even though the suggested UI
      // range maxes out at 2.
      // eslint-disable-next-line no-console
      console.warn(
        `[pro] value ${n} is outside suggested range [${min}, ${max}]`,
      )
    }
    if (n !== value) onChange(n)
    setDraft(formatDefault(n, step))
    lastValueRef.current = n
  }

  return (
    <>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        // Clamp the slider's visual position to [min, max] — the text
        // input is the source of truth for out-of-range values.
        value={Math.min(max, Math.max(min, value))}
        onChange={(e) => {
          const n = Number(e.target.value)
          setDraft(formatDefault(n, step))
          onChange(n)
          lastValueRef.current = n
        }}
        style={S.range}
      />
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            setDraft(formatDefault(value, step))
            e.currentTarget.blur()
          }
        }}
        spellCheck={false}
        style={S.num}
      />
      {label && <span style={S.unit}>{label}</span>}
    </>
  )
}

function formatDefault(v: number, step: number): string {
  if (Number.isInteger(v) && Number.isInteger(step)) return String(v)
  const decimals = Math.max(0, Math.min(4, -Math.floor(Math.log10(step || 1))))
  return v.toFixed(decimals)
}

const S: Record<string, CSSProperties> = {
  range: {
    flex: 1,
    minWidth: 0,
    accentColor: 'var(--color-accent)',
    cursor: 'pointer',
  },
  val: {
    flexShrink: 0,
    minWidth: 36,
    textAlign: 'right',
    fontSize: TYPO.xs,
    fontFamily: 'var(--font-mono)',
    fontWeight: 500,
    color: 'var(--color-text-primary)',
  },
  num: {
    flexShrink: 0,
    width: 64,
    background: 'var(--color-bg-input)',
    border: '1px solid var(--color-border)',
    borderRadius: 3,
    padding: '2px 6px',
    textAlign: 'right',
    fontSize: TYPO.xs,
    fontFamily: 'var(--font-mono)',
    color: 'var(--color-text-primary)',
    outline: 'none',
  },
  unit: {
    flexShrink: 0,
    fontSize: TYPO.xxs,
    color: 'var(--color-text-muted)',
  },
}
