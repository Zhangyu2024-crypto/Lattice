import { useMemo, useState } from 'react'
import { buildSeriesChartInstanceKey } from '../../../../lib/chart-instance-key'
import type { ParsedSpectrum } from '../../../../lib/parsers/types'

/**
 * ECharts-backed line plot for a parsed spectrum. Lazy-loads echarts-for-react
 * on mount to keep it out of the main chunk. Pure presentation except for the
 * async-loaded component ref, which is internal.
 */
export function SpectrumPlot({ spectrum }: { spectrum: ParsedSpectrum }) {
  const [ReactECharts, setReactECharts] = useState<
    typeof import('echarts-for-react').default | null
  >(null)

  useMemo(() => {
    import('echarts-for-react').then((m) => setReactECharts(() => m.default))
  }, [])

  const chartKey = useMemo(
    () =>
      buildSeriesChartInstanceKey({
        x: spectrum.x,
        y: spectrum.y,
        sourceFile: spectrum.metadata.sourceFile,
        seriesType: spectrum.technique,
      }),
    [spectrum.metadata.sourceFile, spectrum.technique, spectrum.x, spectrum.y],
  )

  const option = useMemo(() => {
    const data = spectrum.x.map((xv, i) => [xv, spectrum.y[i]])
    return {
      animation: false,
      grid: { top: 32, right: 24, bottom: 48, left: 64 },
      tooltip: {
        trigger: 'axis' as const,
        backgroundColor: '#1e1e1e',
        borderColor: '#444',
        extraCssText: 'z-index: 10 !important; pointer-events: none;',
        textStyle: { color: '#ddd', fontSize: 'var(--text-xs)' },
        formatter: (params: Array<{ data: [number, number] }>) => {
          const d = params[0]?.data
          if (!d) return ''
          return `${spectrum.xLabel}: ${d[0].toFixed(4)}<br/>${spectrum.yLabel}: ${d[1].toFixed(2)}`
        },
      },
      toolbox: {
        right: 12,
        top: 4,
        itemSize: 13,
        feature: {
          dataZoom: { title: { zoom: 'Box zoom', back: 'Reset' } },
          restore: { title: 'Reset' },
          saveAsImage: { title: 'Export PNG', pixelRatio: 2 },
        },
        iconStyle: { borderColor: '#888' },
        emphasis: { iconStyle: { borderColor: '#ddd' } },
      },
      dataZoom: [
        { type: 'inside' as const, xAxisIndex: 0 },
        { type: 'inside' as const, yAxisIndex: 0 },
        {
          type: 'slider' as const,
          xAxisIndex: 0,
          height: 16,
          bottom: 4,
          borderColor: '#444',
          fillerColor: 'rgba(14, 116, 144, 0.15)',
          handleStyle: { color: '#0e7490' },
          textStyle: { fontSize: 'var(--text-2xs)', color: '#888' },
        },
      ],
      xAxis: {
        type: 'value' as const,
        name: spectrum.xLabel,
        nameLocation: 'middle' as const,
        nameGap: 28,
        nameTextStyle: { fontSize: 'var(--text-xs)', color: '#aaa' },
        axisLabel: { fontSize: 'var(--text-xxs)', color: '#999' },
        splitLine: { lineStyle: { color: '#2a2a2a' } },
      },
      yAxis: {
        type: 'value' as const,
        name: spectrum.yLabel,
        nameLocation: 'middle' as const,
        nameGap: 48,
        nameTextStyle: { fontSize: 'var(--text-xs)', color: '#aaa' },
        axisLabel: { fontSize: 'var(--text-xxs)', color: '#999' },
        splitLine: { lineStyle: { color: '#2a2a2a' } },
      },
      series: [
        {
          type: 'line' as const,
          data,
          showSymbol: data.length < 500,
          symbolSize: 2,
          lineStyle: { width: 1.4, color: '#0e7490' },
          itemStyle: { color: '#0e7490' },
          large: data.length > 5000,
        },
      ],
    }
  }, [spectrum])

  if (!ReactECharts) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--color-text-muted)',
          fontSize: 'var(--text-sm)',
        }}
      >
        Loading chart...
      </div>
    )
  }

  return (
    <div style={{ width: '100%', height: '100%', minHeight: 0 }}>
      <ReactECharts
        key={chartKey}
        option={option}
        style={{ width: '100%', height: '100%' }}
        theme="dark"
        opts={{ renderer: 'canvas' }}
      />
    </div>
  )
}
