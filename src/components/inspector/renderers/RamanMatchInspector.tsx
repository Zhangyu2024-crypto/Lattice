import type { RamanIdArtifact } from '../../../types/artifact'
import InspectorRow from '../InspectorRow'

interface Props {
  artifact: RamanIdArtifact
  elementId: string
}

export default function RamanMatchInspector({ artifact, elementId }: Props) {
  const match = artifact.payload.matches.find((m) => m.id === elementId)
  if (!match) {
    return (
      <div className="inspector-empty">
        Raman match not found in this identification.
      </div>
    )
  }

  return (
    <div className="inspector-section">
      <div className="inspector-section-title">
        {artifact.title} · Raman match
      </div>
      <InspectorRow label="Mineral" value={match.mineralName} accent />
      <InspectorRow label="Formula" value={match.formula} mono />
      <InspectorRow
        label="Score"
        value={(match.cosineScore * 100).toFixed(1)}
        mono
        unit="%"
      />
      <InspectorRow label="Source" value={match.referenceSource} />
      {match.rruffId && (
        <InspectorRow label="RRUFF id" value={match.rruffId} mono />
      )}
      {match.keyPeaks.length > 0 && (
        <InspectorRow
          label="Key peaks"
          value={match.keyPeaks.map((p) => p.toFixed(1)).join(', ')}
          mono
        />
      )}
    </div>
  )
}
