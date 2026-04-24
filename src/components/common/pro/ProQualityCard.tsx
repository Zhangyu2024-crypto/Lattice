import type { CSSProperties } from 'react'
import type { ProDataQuality } from '../../../types/artifact'
import { TYPO } from '../../../lib/typography-inline'
import ProButton from './ProButton'
import ProEmpty from './ProEmpty'

// Shared Data Quality readout used by XRD / XPS / Raman pro workbenches.
// Previously each workbench had a slimmer copy of this; XPS / Raman dropped
// the nPoints counter and the issues list, which this component restores.

interface Props {
  quality: ProDataQuality | null
  busy: boolean
  onAssess: () => void
  /** Prompt shown in the empty state before the first assessment. */
  emptyHint?: string
  /** Label on the action button (default: Assess). */
  actionLabel?: string
}

export default function ProQualityCard({
  quality,
  busy,
  onAssess,
  emptyHint = 'Load a file to assess quality',
  actionLabel = 'Assess',
}: Props) {
  return (
    <>
      {quality ? (
        <div style={S.row}>
          <span style={S.grade(quality.grade)}>
            {quality.grade.toUpperCase()}
          </span>
          {quality.snr != null && (
            <span style={S.stat}>SNR {quality.snr}</span>
          )}
          {quality.nPoints != null && (
            <span style={S.stat}>{quality.nPoints} pts</span>
          )}
        </div>
      ) : (
        <ProEmpty compact>{emptyHint}</ProEmpty>
      )}
      {quality?.issues.map((iss, i) => (
        <div key={`iss-${i}`} style={S.issue}>
          · {iss}
        </div>
      ))}
      <ProButton onClick={onAssess} loading={busy} fullWidth compact>
        {actionLabel}
      </ProButton>
    </>
  )
}

const S: {
  row: CSSProperties
  stat: CSSProperties
  issue: CSSProperties
  grade: (g: ProDataQuality['grade']) => CSSProperties
} = {
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    fontSize: TYPO.xs,
  },
  stat: {
    fontFamily: 'var(--font-mono)',
    fontSize: TYPO.xxs,
    color: 'var(--color-text-secondary)',
  },
  issue: {
    fontSize: TYPO.xxs,
    color: 'var(--color-text-muted)',
    paddingLeft: 4,
  },
  grade: (g) => ({
    padding: '3px 10px',
    borderRadius: 4,
    fontWeight: 600,
    fontSize: TYPO.xxs,
    letterSpacing: '0.06em',
    border: '1px solid',
    borderColor:
      g === 'good'
        ? 'color-mix(in srgb, var(--color-green) 45%, transparent)'
        : g === 'fair'
          ? 'color-mix(in srgb, var(--color-yellow) 45%, transparent)'
          : 'color-mix(in srgb, var(--color-red) 45%, transparent)',
    color:
      g === 'good'
        ? 'var(--color-green)'
        : g === 'fair'
          ? 'var(--color-yellow)'
          : 'var(--color-red)',
    background:
      g === 'good'
        ? 'color-mix(in srgb, var(--color-green) 12%, transparent)'
        : g === 'fair'
          ? 'color-mix(in srgb, var(--color-yellow) 12%, transparent)'
          : 'color-mix(in srgb, var(--color-red) 12%, transparent)',
  }),
}
