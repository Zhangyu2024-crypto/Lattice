import type {
  XpsAnalysisArtifact,
  XpsQuantRow,
} from '../../../types/artifact'
import InspectorRow from '../InspectorRow'

interface Props {
  artifact: XpsAnalysisArtifact
  elementId: string
}

/**
 * Quant rows have no domain id, so callers identify them by element symbol or
 * a positional fallback. Both forms are accepted.
 */
function matchesQuantRow(
  elementId: string,
  row: XpsQuantRow,
  index: number,
): boolean {
  return (
    elementId === row.element ||
    elementId === `quant_${index}` ||
    elementId === `xps_quant_${index}`
  )
}

export default function XpsQuantRowInspector({ artifact, elementId }: Props) {
  const row = artifact.payload.quantification.find((r, i) =>
    matchesQuantRow(elementId, r, i),
  )
  if (!row) {
    return (
      <div className="inspector-empty">
        Quantification row not found in this analysis.
      </div>
    )
  }

  return (
    <div className="inspector-section">
      <div className="inspector-section-title">
        {artifact.title} · XPS quant row
      </div>
      <InspectorRow label="Element" value={row.element} accent mono />
      <InspectorRow
        label="Atomic %"
        value={row.atomicPercent.toFixed(2)}
        mono
        unit="%"
      />
      <InspectorRow
        label="RSF"
        value={row.relativeSensitivity.toFixed(3)}
        mono
      />
    </div>
  )
}
