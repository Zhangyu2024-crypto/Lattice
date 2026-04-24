import type { XrdAnalysisArtifact } from '../../../types/artifact'
import InspectorRow from '../InspectorRow'

interface Props {
  artifact: XrdAnalysisArtifact
  elementId: string
}

export default function PhaseInspector({ artifact, elementId }: Props) {
  const phase = artifact.payload.phases.find((p) => p.id === elementId)
  if (!phase) {
    return <div className="inspector-empty">Phase not found in this analysis.</div>
  }

  return (
    <div className="inspector-section">
      <div className="inspector-section-title">{artifact.title} · Phase</div>
      <InspectorRow label="Name" value={phase.name} accent />
      <InspectorRow label="Formula" value={phase.formula} mono />
      <InspectorRow label="Space group" value={phase.spaceGroup} mono />
      <InspectorRow
        label="Confidence"
        value={(phase.confidence * 100).toFixed(1)}
        mono
        unit="%"
      />
      {phase.weightFraction != null && (
        <InspectorRow
          label="Weight frac."
          value={(phase.weightFraction * 100).toFixed(1)}
          mono
          unit="%"
        />
      )}
      <InspectorRow
        label="Matched peaks"
        value={phase.matchedPeaks.length}
        mono
      />
      {phase.cifRef && (
        <InspectorRow label="CIF ref" value={phase.cifRef} mono />
      )}
    </div>
  )
}
