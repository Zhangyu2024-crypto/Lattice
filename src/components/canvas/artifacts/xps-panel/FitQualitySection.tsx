// Fit Quality section — renders reduced χ², R², Nvars/Npts as a compact
// stats strip, plus any soft warnings and correlation warnings the
// worker surfaced. Collapses itself when there's nothing to show so the
// section doesn't flicker in/out during the initial load.

import type { XpsProPayload } from '../../../../types/artifact'
import { ProSection } from '../../../common/pro'
import {
  classifyChiSq,
  formatChiSq,
  formatDegreesOfFreedom,
  formatRSquared,
} from '../../../../lib/xps-fit-stats'

export default function FitQualitySection({
  fitResult,
}: {
  fitResult: XpsProPayload['fitResult']
}) {
  const stats = fitResult?.fitStatistics
  const warnings = fitResult?.warnings ?? []
  const corrWarnings = fitResult?.correlationWarnings ?? []
  const hasStats = stats != null
  const hasWarnings = warnings.length > 0 || corrWarnings.length > 0
  if (!hasStats && !hasWarnings) return null

  const band = classifyChiSq(stats?.reducedChiSquared)
  const bandColor =
    band === 'ideal'
      ? 'var(--color-text-primary)'
      : band === 'acceptable'
        ? 'var(--color-text-secondary)'
        : band === 'poor'
          ? 'var(--color-accent, var(--color-text-primary))'
          : 'var(--color-text-muted)'

  return (
    <ProSection title="Fit Quality">
      {hasStats && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: 6,
            padding: '2px 0 6px',
          }}
        >
          <StatCell
            label="R²"
            value={formatRSquared(stats?.rSquared)}
            color="var(--color-text-primary)"
          />
          <StatCell
            label="χ²ᵣ"
            value={formatChiSq(stats?.reducedChiSquared)}
            color={bandColor}
          />
          <StatCell
            label="Nvars / pts"
            value={formatDegreesOfFreedom(
              stats?.nVariables,
              stats?.nDataPoints,
            )}
            color="var(--color-text-primary)"
          />
        </div>
      )}
      {(warnings.length > 0 || corrWarnings.length > 0) && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            marginTop: 4,
            padding: '6px 8px',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-bg-base)',
          }}
        >
          {warnings.map((w, i) => (
            <div
              key={`w-${i}`}
              style={{
                fontSize: 'var(--text-xxs)',
                color: 'var(--color-text-secondary)',
                lineHeight: 1.4,
              }}
            >
              ⚠ {w}
            </div>
          ))}
          {corrWarnings.map((w, i) => (
            <div
              key={`cw-${i}`}
              style={{
                fontSize: 'var(--text-xxs)',
                color: 'var(--color-text-secondary)',
                lineHeight: 1.4,
              }}
            >
              ⚠ correlation: {w}
            </div>
          ))}
        </div>
      )}
    </ProSection>
  )
}

function StatCell({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        padding: '6px 8px',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--color-bg-base)',
      }}
    >
      <span
        style={{
          fontSize: 'var(--text-xxs)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--color-text-muted)',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-sm)',
          color,
        }}
      >
        {value}
      </span>
    </div>
  )
}
