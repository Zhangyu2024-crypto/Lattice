import type { PeakFitArtifact } from '../../../types/artifact'
import InspectorRow from '../InspectorRow'

type PeakRow = PeakFitArtifact['payload']['peaks'][number]

interface Props {
  artifact: PeakFitArtifact
  elementId: string
}

/**
 * Match a peak by its stable id, falling back to the legacy numeric prefix
 * used by pre-MP-1 callers (`peak_${index}`). The MP-1 backfill rewrites
 * persisted ids to `peak_${index}_${suffix}`, so a stored elementId of the
 * old shorter form still matches via the prefix branch.
 */
function matchesPeak(elementId: string, peak: PeakRow): boolean {
  if (peak.id === elementId) return true
  const indexBased = `peak_${peak.index}`
  if (elementId === indexBased) return true
  return (
    typeof peak.id === 'string' && peak.id.startsWith(`${indexBased}_`)
  )
}

export default function PeakInspector({ artifact, elementId }: Props) {
  const peak = artifact.payload.peaks.find((p) => matchesPeak(elementId, p))
  if (!peak) {
    return <div className="inspector-empty">Peak not found in this fit.</div>
  }

  return (
    <div className="inspector-section">
      <div className="inspector-section-title">{artifact.title} · Peak</div>
      <InspectorRow
        label="Label"
        value={peak.label || `Peak ${peak.index + 1}`}
        accent
      />
      <InspectorRow label="Index" value={peak.index + 1} mono />
      <InspectorRow label="Position" value={peak.position.toFixed(2)} mono />
      <InspectorRow
        label="Intensity"
        value={peak.intensity.toFixed(1)}
        mono
      />
      {peak.fwhm != null && (
        <InspectorRow label="FWHM" value={peak.fwhm.toFixed(2)} mono />
      )}
      {peak.area != null && (
        <InspectorRow label="Area" value={peak.area.toFixed(2)} mono />
      )}
      {peak.snr != null && (
        <InspectorRow label="SNR" value={peak.snr.toFixed(1)} mono />
      )}
    </div>
  )
}
