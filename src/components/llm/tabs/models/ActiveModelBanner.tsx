import { AlertCircle, CheckCircle2, Star } from 'lucide-react'
import type { ProviderGroup } from './types'

interface ActiveModelBannerProps {
  variant: 'empty' | 'needs-connect' | 'needs-pick' | 'ready' | 'stale'
  title: string
  detail: string
  summary: {
    providerName: string
    modelLabel: string
    providerEnabled: boolean
    modelKnown: boolean
  } | null
  canPick: boolean
  groups: ProviderGroup[]
  value: string
  onChange: (val: string) => void
}

export default function ActiveModelBanner({
  variant,
  title,
  detail,
  summary,
  canPick,
  groups,
  value,
  onChange,
}: ActiveModelBannerProps) {
  const ok = variant === 'ready'
  const alert = variant === 'stale' || variant === 'needs-connect'
  return (
    <div
      className={
        'llm-models-active-banner' +
        (ok ? ' is-ready' : '') +
        (alert ? ' is-alert' : '')
      }
    >
      <div className="llm-models-active-banner-head">
        {ok ? (
          <CheckCircle2 size={16} aria-hidden />
        ) : alert ? (
          <AlertCircle size={16} aria-hidden />
        ) : (
          <Star size={16} aria-hidden />
        )}
        <div className="llm-models-active-banner-text">
          <strong>{title}</strong>
          <span>{detail}</span>
        </div>
        {ok && summary ? (
          <span className="llm-models-model-badge">
            <strong className="llm-models-model-badge-provider">
              {summary.providerName}
            </strong>
            <span className="llm-models-model-badge-sep">/</span>
            <span className="llm-models-model-badge-model">
              {summary.modelLabel}
            </span>
          </span>
        ) : null}
      </div>
      {canPick ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="llm-input llm-input--full llm-cursor-pointer llm-models-active-select"
          aria-label="Default service connection"
        >
          <option value="">
            {variant === 'needs-pick' || variant === 'stale'
              ? '— pick a route —'
              : '(none)'}
          </option>
          {groups.map((g) => (
            <optgroup
              key={g.providerId}
              label={g.disabled ? `${g.providerName} (disabled)` : g.providerName}
            >
              {g.models.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.modelLabel}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      ) : null}
    </div>
  )
}
