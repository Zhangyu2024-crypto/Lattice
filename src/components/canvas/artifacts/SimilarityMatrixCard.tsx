import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import type { Artifact } from '../../../types/artifact'
import { CHART_TEXT_PX } from '../../../lib/chart-text-px'
import { Badge, EmptyState } from '../../ui'

interface SimilarityMatrixPayload {
  sources: Array<{ id: string; label: string }>
  metric: 'pearson' | 'cosine'
  matrix: number[][]
  computedAt: number
}

interface Props {
  artifact: Artifact
}

export default function SimilarityMatrixCard({ artifact }: Props) {
  const payload = artifact.payload as unknown as SimilarityMatrixPayload
  const { sources, matrix, metric } = payload

  const option = useMemo(() => buildOption(sources, matrix, metric), [sources, matrix, metric])

  if (!sources.length || !matrix.length) {
    return (
      <EmptyState
        title="No sources to compare"
        hint="Pin at least 2 spectrum artifacts first."
      />
    )
  }

  return (
    <div className="card-similarity-root">
      <div className="card-similarity-header">
        <span>
          <strong className="card-similarity-num">{sources.length}</strong>{' '}
          sources ×{' '}
          <strong className="card-similarity-num">{sources.length}</strong>
        </span>
        <span>·</span>
        <Badge variant="neutral">{metric}</Badge>
        <span className="card-similarity-spacer" />
        <span>computed {relativeTime(payload.computedAt)}</span>
      </div>

      <div className="card-similarity-chart-wrap">
        <ReactECharts
          option={option}
          className="card-similarity-echarts"
          opts={{ renderer: 'canvas' }}
        />
      </div>
    </div>
  )
}

function buildOption(
  sources: SimilarityMatrixPayload['sources'],
  matrix: number[][],
  metric: string,
) {
  const labels = sources.map((s) => s.label)
  const data: [number, number, number][] = []
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i].length; j++) {
      data.push([j, i, Number(matrix[i][j].toFixed(3))])
    }
  }

  return {
    backgroundColor: 'transparent',
    animation: false,
    grid: { top: 60, right: 80, bottom: 100, left: 120 },
    tooltip: {
      backgroundColor: 'rgba(20,20,20,0.96)',
      borderColor: '#2A2A2A',
      extraCssText: 'z-index: 10 !important; pointer-events: none;',
      textStyle: { color: '#cccccc', fontSize: CHART_TEXT_PX.sm },
      formatter: (p: any) => {
        const [j, i, v] = p.data as [number, number, number]
        return `${labels[i]} vs ${labels[j]}<br/>${metric}: <strong>${v.toFixed(3)}</strong>`
      },
    },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: {
        color: '#888888',
        fontSize: CHART_TEXT_PX.xs,
        rotate: 30,
        interval: 0,
      },
      axisLine: { lineStyle: { color: '#2A2A2A' } },
      splitArea: { show: true },
    },
    yAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: '#888888', fontSize: CHART_TEXT_PX.xs },
      axisLine: { lineStyle: { color: '#2A2A2A' } },
      splitArea: { show: true },
      inverse: true,
    },
    visualMap: {
      min: 0,
      max: 1,
      calculable: true,
      orient: 'vertical',
      right: 10,
      top: 'middle',
      textStyle: { color: '#888888', fontSize: CHART_TEXT_PX.xxs },
      inRange: {
        color: ['#0A0A0A', '#303030', '#606060', '#A0A0A0', '#E8E8E8'],
      },
    },
    series: [
      {
        name: metric,
        type: 'heatmap',
        data,
        label: {
          show: true,
          formatter: (p: any) => (p.data[2] as number).toFixed(2),
          color: '#ffffff',
          fontSize: CHART_TEXT_PX.xxs,
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowColor: 'rgba(0, 0, 0, 0.5)',
          },
        },
      },
    ],
  }
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}
