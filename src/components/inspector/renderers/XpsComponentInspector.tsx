import type {
  XpsAnalysisArtifact,
  XpsFit,
  XpsPeak,
} from '../../../types/artifact'
import InspectorRow from '../InspectorRow'

interface Props {
  artifact: XpsAnalysisArtifact
  elementId: string
}

function matchesPeak(
  elementId: string,
  peak: XpsPeak,
  fitIndex: number,
  peakIndex: number,
): boolean {
  if (peak.id === elementId) return true
  if (typeof peak.id === 'string' && peak.id.startsWith(`${elementId}_`)) {
    return true
  }
  // Index-based fallback for pre-MP-1 callers / fixtures.
  return elementId === `xp_${fitIndex}_${peakIndex}`
}

function findComponent(
  artifact: XpsAnalysisArtifact,
  elementId: string,
): { fit: XpsFit; peak: XpsPeak } | null {
  const fits = artifact.payload.fits
  for (let fitIndex = 0; fitIndex < fits.length; fitIndex++) {
    const fit = fits[fitIndex]
    for (let peakIndex = 0; peakIndex < fit.peaks.length; peakIndex++) {
      const peak = fit.peaks[peakIndex]
      if (matchesPeak(elementId, peak, fitIndex, peakIndex)) {
        return { fit, peak }
      }
    }
  }
  return null
}

export default function XpsComponentInspector({ artifact, elementId }: Props) {
  const found = findComponent(artifact, elementId)
  if (!found) {
    return (
      <div className="inspector-empty">
        XPS component not found in this analysis.
      </div>
    )
  }
  const { fit, peak } = found

  return (
    <div className="inspector-section">
      <div className="inspector-section-title">
        {artifact.title} · XPS component
      </div>
      <InspectorRow label="Fit" value={`${fit.element} ${fit.line}`} accent />
      <InspectorRow label="Label" value={peak.label || 'Component'} accent />
      {peak.assignment && (
        <InspectorRow label="Assignment" value={peak.assignment} />
      )}
      <InspectorRow
        label="Binding"
        value={peak.binding.toFixed(2)}
        mono
        unit="eV"
      />
      <InspectorRow
        label="FWHM"
        value={peak.fwhm.toFixed(2)}
        mono
        unit="eV"
      />
      <InspectorRow label="Area" value={peak.area.toFixed(2)} mono />
      <InspectorRow
        label="Range"
        value={`${fit.bindingRange[0].toFixed(1)} – ${fit.bindingRange[1].toFixed(1)}`}
        mono
        unit="eV"
      />
      <InspectorRow label="Background" value={fit.background} mono />
    </div>
  )
}
