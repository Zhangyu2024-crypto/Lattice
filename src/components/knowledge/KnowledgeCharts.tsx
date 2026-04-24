// KnowledgeCharts — ECharts-based visualization panels for the knowledge
// database. Wraps heatmap, timeline, and metric distribution endpoints.
// Renders inside a tab panel in KnowledgeBrowserModal.

import { useCallback, useEffect, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { Loader2 } from 'lucide-react'
import { CHART_PRIMARY, CHART_SECONDARY } from '../../lib/chart-colors'
import { CHART_TEXT_PX } from '../../lib/chart-text-px'
import { localProKnowledge } from '../../lib/local-pro-knowledge'
import type {
  HeatmapResponse,
  ExtractionTimelineResponse,
  MetricDistributionResponse,
} from '../../types/knowledge-api'

type ChartMode = 'heatmap' | 'timeline' | 'metric'

interface Props {
  visible: boolean
}

export default function KnowledgeCharts({ visible }: Props) {
  const api = localProKnowledge
  const [mode, setMode] = useState<ChartMode>('heatmap')
  const [loading, setLoading] = useState(false)

  const [heatmapData, setHeatmapData] = useState<HeatmapResponse | null>(null)
  const [timelineData, setTimelineData] = useState<ExtractionTimelineResponse | null>(null)
  const [metricData, setMetricData] = useState<MetricDistributionResponse | null>(null)
  const [metricName, setMetricName] = useState('band_gap')

  const loadHeatmap = useCallback(async () => {
    if (!api.ready) return
    setLoading(true)
    try {
      const res = await api.heatmap({ max_materials: 15, max_metrics: 15 })
      setHeatmapData(res)
    } catch { /* silent */ } finally { setLoading(false) }
  }, [api])

  const loadTimeline = useCallback(async () => {
    if (!api.ready) return
    setLoading(true)
    try {
      const res = await api.timeline()
      setTimelineData(res)
    } catch { /* silent */ } finally { setLoading(false) }
  }, [api])

  const loadMetric = useCallback(async (metric: string) => {
    if (!api.ready) return
    setLoading(true)
    try {
      const res = await api.metricDistribution(metric, 20)
      setMetricData(res)
    } catch { /* silent */ } finally { setLoading(false) }
  }, [api])

  useEffect(() => {
    if (!visible || !api.ready) return
    if (mode === 'heatmap' && !heatmapData) void loadHeatmap()
    if (mode === 'timeline' && !timelineData) void loadTimeline()
    if (mode === 'metric' && !metricData) void loadMetric(metricName)
  }, [visible, api.ready, mode, heatmapData, timelineData, metricData, metricName, loadHeatmap, loadTimeline, loadMetric])

  if (!visible) return null

  const heatmapOption = useMemo(() => {
    if (!heatmapData) return null
    const { materials, metrics, data } = heatmapData
    const ecData: Array<[number, number, number | null]> = []
    for (let mi = 0; mi < materials.length; mi++) {
      for (let me = 0; me < metrics.length; me++) {
        ecData.push([me, mi, data[mi]?.[me] ?? null])
      }
    }
    return {
      backgroundColor: 'transparent',
      tooltip: {
        position: 'top' as const,
        extraCssText: 'z-index: 10 !important; pointer-events: none;',
      },
      grid: { top: 40, right: 20, bottom: 80, left: 120 },
      xAxis: { type: 'category' as const, data: metrics, axisLabel: { rotate: 45, fontSize: CHART_TEXT_PX['2xs'], color: '#888' } },
      yAxis: { type: 'category' as const, data: materials, axisLabel: { fontSize: CHART_TEXT_PX['2xs'], color: '#888' } },
      visualMap: { min: 0, max: 100, calculable: true, orient: 'horizontal' as const, left: 'center' as const, bottom: 0, inRange: { color: ['#0A0A0A', '#525252', '#E8E8E8'] } },
      series: [{ type: 'heatmap' as const, data: ecData, label: { show: true, fontSize: CHART_TEXT_PX['2xs'] } }],
    }
  }, [heatmapData])

  const timelineOption = useMemo(() => {
    if (!timelineData) return null
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis' as const,
        extraCssText: 'z-index: 10 !important; pointer-events: none;',
      },
      grid: { top: 30, right: 20, bottom: 40, left: 50 },
      xAxis: { type: 'category' as const, data: timelineData.dates, axisLabel: { rotate: 30, fontSize: CHART_TEXT_PX['2xs'], color: '#888' } },
      yAxis: { type: 'value' as const, axisLabel: { fontSize: CHART_TEXT_PX['2xs'], color: '#888' } },
      series: [
        { name: 'Chains', type: 'bar' as const, data: timelineData.chains, itemStyle: { color: CHART_PRIMARY } },
        { name: 'Nodes', type: 'bar' as const, data: timelineData.nodes, itemStyle: { color: CHART_SECONDARY } },
      ],
      legend: { top: 4, right: 10, textStyle: { color: '#888', fontSize: CHART_TEXT_PX.xxs } },
    }
  }, [timelineData])

  const metricOption = useMemo(() => {
    if (!metricData) return null
    return {
      backgroundColor: 'transparent',
      tooltip: {
        extraCssText: 'z-index: 10 !important; pointer-events: none;',
      },
      grid: { top: 30, right: 20, bottom: 60, left: 50 },
      xAxis: { type: 'category' as const, data: metricData.groups.map(g => g.name), axisLabel: { rotate: 30, fontSize: CHART_TEXT_PX['2xs'], color: '#888' } },
      yAxis: { type: 'value' as const, axisLabel: { fontSize: CHART_TEXT_PX['2xs'], color: '#888' } },
      series: [{
        type: 'boxplot' as const,
        data: metricData.groups.map(g => {
          const sorted = [...g.values].sort((a, b) => a - b)
          if (sorted.length === 0) return [0, 0, 0, 0, 0]
          const q1 = sorted[Math.floor(sorted.length * 0.25)]
          const q2 = sorted[Math.floor(sorted.length * 0.5)]
          const q3 = sorted[Math.floor(sorted.length * 0.75)]
          return [sorted[0], q1, q2, q3, sorted[sorted.length - 1]]
        }),
      }],
    }
  }, [metricData])

  return (
    <div className="knowledge-charts-root">
      <div className="knowledge-charts-mode-bar">
        {(['heatmap', 'timeline', 'metric'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={[
              'knowledge-charts-mode-btn',
              mode === m ? 'is-active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {m === 'heatmap' ? 'Material x Metric' : m === 'timeline' ? 'Timeline' : 'Distribution'}
          </button>
        ))}
        {mode === 'metric' && (
          <input
            value={metricName}
            onChange={(e) => { setMetricName(e.target.value); setMetricData(null) }}
            placeholder="metric name"
            className="knowledge-charts-metric-input"
          />
        )}
      </div>
      <div className="knowledge-charts-area">
        {loading && (
          <div className="knowledge-charts-loading-overlay">
            <Loader2 size={20} className="spin" />
          </div>
        )}
        {mode === 'heatmap' && heatmapOption && (
          <ReactECharts
            option={heatmapOption}
            className="knowledge-charts-react-echarts"
            style={REACT_ECHARTS_STYLE}
          />
        )}
        {mode === 'timeline' && timelineOption && (
          <ReactECharts
            option={timelineOption}
            className="knowledge-charts-react-echarts"
            style={REACT_ECHARTS_STYLE}
          />
        )}
        {mode === 'metric' && metricOption && (
          <ReactECharts
            option={metricOption}
            className="knowledge-charts-react-echarts"
            style={REACT_ECHARTS_STYLE}
          />
        )}
        {!loading && !heatmapOption && mode === 'heatmap' && (
          <div className="knowledge-charts-empty">
            No heatmap data. Extract knowledge from papers to populate.
          </div>
        )}
        {!loading && !timelineOption && mode === 'timeline' && (
          <div className="knowledge-charts-empty">No timeline data.</div>
        )}
        {!loading && !metricOption && mode === 'metric' && (
          <div className="knowledge-charts-empty">
            Enter a metric name and press Enter.
          </div>
        )}
      </div>
    </div>
  )
}

// `echarts-for-react` writes to the wrapper <div>'s inline style via its
// `style` prop — `className` is forwarded too, but the library resizes
// the chart off the inline height/width values. Keeping the constant
// reference stable avoids re-renders that would re-init ECharts.
const REACT_ECHARTS_STYLE = { height: '100%', width: '100%' } as const
