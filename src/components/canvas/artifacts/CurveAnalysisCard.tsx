// Read-only snapshot card for the `curve-analysis` artifact kind. Tiny
// counterpart to XrdAnalysisCard / RamanIdCard for the generic curve
// type. Renders the experimental curve + a feature table; no editing.

import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import type {
  Artifact,
  CurveAnalysisArtifact,
  CurveFeature,
} from '../../../types/artifact'
import { isCurveAnalysisArtifact } from '../../../types/artifact'
import { buildSpectrumChartOption } from '../../../lib/pro-chart'

interface Props {
  artifact: Artifact
}

export default function CurveAnalysisCard({ artifact }: Props) {
  if (!isCurveAnalysisArtifact(artifact)) {
    return (
      <div className="card-curve-error">
        CurveAnalysisCard received wrong kind: {artifact.kind}
      </div>
    )
  }
  return <Inner artifact={artifact} />
}

function Inner({ artifact }: { artifact: CurveAnalysisArtifact }) {
  const { experimentalCurve, features, notes } = artifact.payload

  const chartOption = useMemo(
    () =>
      buildSpectrumChartOption({
        spectrum: {
          x: experimentalCurve.x,
          y: experimentalCurve.y,
          xLabel: experimentalCurve.xLabel ?? 'x',
          yLabel: experimentalCurve.yLabel ?? 'y',
          spectrumType: 'curve',
          sourceFile: null,
        },
        peaks: features.map((f) => ({
          position: f.position,
          intensity: f.intensity,
          fwhm: f.fwhm,
        })),
        overlays: [],
      }),
    [experimentalCurve, features],
  )

  return (
    <div className="card-curve-root">
      <div className="card-curve-header">
        Curve analysis · {features.length} feature{features.length === 1 ? '' : 's'}
      </div>
      <div className="card-curve-chart-wrap">
        <ReactECharts
          option={chartOption}
          notMerge
          className="card-curve-echarts"
          opts={{ renderer: 'canvas' }}
        />
      </div>
      {features.length > 0 && (
        <div className="card-curve-table-scroll">
          <FeatureTable features={features} />
        </div>
      )}
      {notes && (
        <div className="card-curve-notes">
          {notes}
        </div>
      )}
    </div>
  )
}

function FeatureTable({ features }: { features: CurveFeature[] }) {
  return (
    <div>
      <div className="card-curve-table-head">
        <span>#</span>
        <span>position</span>
        <span>intensity</span>
        <span>fwhm</span>
        <span>label</span>
      </div>
      {features.map((f, i) => (
        <div key={`feat-${i}`} className="card-curve-table-row">
          <span>{i + 1}</span>
          <span>{f.position.toFixed(3)}</span>
          <span>{f.intensity.toFixed(2)}</span>
          <span>{f.fwhm?.toFixed(3) ?? '—'}</span>
          <span>{f.label ?? ''}</span>
        </div>
      ))}
    </div>
  )
}
