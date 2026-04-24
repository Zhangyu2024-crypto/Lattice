import { colorForPct } from './types'

// ─── Generic building blocks ────────────────────────────────────────────
// Purely presentational — no store access, no side effects. Shared between
// BudgetLimits and RateLimitBlock.

export function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="llm-budget-section">
      <div className="llm-budget-section-title">{title}</div>
      <div className="llm-budget-section-body">{children}</div>
    </div>
  )
}

export function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="llm-budget-field">
      <span className="llm-budget-field-label">{label}</span>
      <div>{children}</div>
    </div>
  )
}

export function NumberInput({
  value,
  onChange,
  min,
  step,
}: {
  value: number
  onChange: (n: number) => void
  min: number
  step: number
}) {
  return (
    <input
      type="number"
      min={min}
      step={step}
      value={value}
      onChange={(e) => {
        const n = parseInt(e.target.value, 10)
        if (Number.isFinite(n)) onChange(Math.max(min, n))
      }}
      className="llm-input llm-budget-input--num"
    />
  )
}

export interface LimitPairProps {
  tokenValue: number | null
  tokenOnChange: (v: number | null) => void
  costValue: number | null
  costOnChange: (v: number | null) => void
}

export function LimitPair({
  tokenValue,
  tokenOnChange,
  costValue,
  costOnChange,
}: LimitPairProps) {
  return (
    <>
      <Field label="Token limit">
        <ToggleNumber
          value={tokenValue}
          onChange={tokenOnChange}
          step={1000}
          min={1000}
          placeholder="e.g. 500000"
        />
      </Field>
      <Field label="Cost limit">
        <ToggleNumber
          value={costValue}
          onChange={costOnChange}
          step={0.5}
          min={0.1}
          placeholder="e.g. 5.00"
          prefix="$"
          decimal
        />
      </Field>
    </>
  )
}

export interface ToggleNumberProps {
  value: number | null
  onChange: (v: number | null) => void
  step: number
  min: number
  placeholder?: string
  prefix?: string
  decimal?: boolean
}

export function ToggleNumber({
  value,
  onChange,
  step,
  min,
  placeholder,
  prefix,
  decimal,
}: ToggleNumberProps) {
  const enabled = value !== null
  return (
    <div className="llm-budget-toggle-number">
      <label className="llm-budget-toggle-label">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange(e.target.checked ? (value ?? min) : null)}
          className="llm-cursor-pointer"
        />
        Enabled
      </label>
      <div className="llm-budget-number-wrap">
        {prefix && <span className="llm-budget-prefix">{prefix}</span>}
        <input
          type="number"
          min={min}
          step={step}
          value={value ?? ''}
          disabled={!enabled}
          placeholder={placeholder}
          onChange={(e) => {
            const raw = e.target.value
            if (raw === '') {
              onChange(enabled ? min : null)
              return
            }
            const n = decimal ? parseFloat(raw) : parseInt(raw, 10)
            if (Number.isFinite(n)) onChange(n)
          }}
          className={`llm-input llm-budget-input--num${enabled ? '' : ' llm-input--dim'}`}
        />
      </div>
    </div>
  )
}

export function ProgressBar({
  label,
  current,
  limit,
  formatter,
}: {
  label: string
  current: number
  limit: number | null
  formatter: (n: number) => string
}) {
  const pct = limit && limit > 0 ? Math.min(1, current / limit) : 0
  const fillPct = `${Math.max(2, pct * 100)}%`
  return (
    <div className="llm-budget-progress-block">
      <div className="llm-budget-progress-head">
        <span className="llm-budget-progress-label">{label}</span>
        <span className="llm-budget-progress-value">
          {formatter(current)}
          {limit !== null
            ? ` / ${formatter(limit)} (${Math.round(pct * 100)}%)`
            : ' (no limit set)'}
        </span>
      </div>
      <div className="llm-budget-progress-track">
        <div
          className="llm-budget-progress-fill"
          style={
            {
              '--fill-pct': fillPct,
              '--fill-color': colorForPct(pct, limit),
            } as React.CSSProperties
          }
        />
      </div>
    </div>
  )
}
