import { memo, useEffect, useMemo, useRef } from 'react'
import ReactECharts from 'echarts-for-react'
import type { PeakFitArtifact, SpectrumArtifact } from '../../../types/artifact'
import { CHART_PRIMARY, CHART_SECONDARY } from '../../../lib/chart-colors'
import { buildSeriesChartInstanceKey } from '../../../lib/chart-instance-key'
import { buildPeakMarker } from '../../../lib/chart-peak-markers'
import { CHART_FONT_MONO, CHART_FONT_SANS } from '../../../lib/chart-font-stacks'
import { CHART_TEXT_PX } from '../../../lib/chart-text-px'
import { Card, CardBody, EmptyState } from '../../ui'

interface Props {
  spectrum: SpectrumArtifact
  overlayPeakFit?: PeakFitArtifact | null
  constraintAnchors?: number[]
  onChartClick?: (x: number, y: number) => void
}

function SpectrumArtifactCardImpl({
  spectrum,
  overlayPeakFit,
  constraintAnchors,
  onChartClick,
}: Props) {
  const chartRef = useRef<ReactECharts | null>(null)
  const { payload } = spectrum

  useEffect(() => {
    if (!onChartClick) return
    const instance = chartRef.current?.getEchartsInstance()
    if (!instance) return
    const zr = instance.getZr()
    const handler = (e: { offsetX: number; offsetY: number; target?: unknown }) => {
      if (e.target) return
      const dataPoint = instance.convertFromPixel({ seriesIndex: 0 }, [
        e.offsetX,
        e.offsetY,
      ]) as [number, number]
      if (!Array.isArray(dataPoint)) return
      onChartClick(dataPoint[0], dataPoint[1])
    }
    zr.on('click', handler)
    return () => {
      zr.off('click', handler)
    }
  }, [onChartClick, spectrum])

  const peaks = overlayPeakFit?.payload.peaks ?? []
  const peakMarkers = useMemo(
    () =>
      peaks.map((p) =>
        buildPeakMarker({
          x: p.position,
          y: p.intensity,
          name: p.label || `${p.position.toFixed(1)}`,
          color: CHART_SECONDARY,
          symbolSize: CHART_TEXT_PX.xs,
          symbolOffsetY: -8,
          labelFontSize: CHART_TEXT_PX.xs,
          labelDistance: 7,
        }),
      ),
    [peaks],
  )

  const anchors = constraintAnchors ?? []
  const anchorLines = useMemo(
    () => anchors.map((x) => [{ coord: [x, 'min'] }, { coord: [x, 'max'] }]),
    [anchors],
  )

  const seriesData = useMemo(
    () => payload.x.map((x, i) => [x, payload.y[i]]),
    [payload.x, payload.y],
  )
  const chartKey = useMemo(
    () =>
      buildSeriesChartInstanceKey({
        x: payload.x,
        y: payload.y,
        sourceFile: spectrum.sourceFile ?? null,
        seriesType: payload.spectrumType ?? null,
      }),
    [payload.x, payload.y, payload.spectrumType, spectrum.sourceFile],
  )

  const option = useMemo(
    () => ({
      backgroundColor: 'transparent',
      animation: false,
      grid: { top: 40, right: 28, bottom: 60, left: 68 },
      xAxis: {
        type: 'value' as const,
        name: payload.xLabel,
        nameLocation: 'middle' as const,
        nameGap: 36,
        nameTextStyle: {
          color: '#999999',
          fontSize: CHART_TEXT_PX.sm,
          fontFamily: CHART_FONT_SANS,
          fontWeight: 500,
        },
        axisLabel: {
          color: '#888888',
          fontSize: CHART_TEXT_PX.sm,
          fontFamily: CHART_FONT_MONO,
          fontWeight: 500,
        },
        axisLine: { lineStyle: { color: '#2A2A2A' } },
        axisTick: { lineStyle: { color: '#2A2A2A' } },
        splitLine: {
          lineStyle: { color: '#1F1F1F', type: 'dashed' as const },
        },
      },
      yAxis: {
        type: 'value' as const,
        name: payload.yLabel,
        nameLocation: 'middle' as const,
        nameGap: 52,
        nameTextStyle: {
          color: '#999999',
          fontSize: CHART_TEXT_PX.sm,
          fontFamily: CHART_FONT_SANS,
          fontWeight: 500,
        },
        axisLabel: {
          color: '#888888',
          fontSize: CHART_TEXT_PX.sm,
          fontFamily: CHART_FONT_MONO,
          fontWeight: 500,
        },
        axisLine: { lineStyle: { color: '#2A2A2A' } },
        axisTick: { lineStyle: { color: '#2A2A2A' } },
        splitLine: {
          lineStyle: { color: '#1F1F1F', type: 'dashed' as const },
        },
      },
      dataZoom: [
        { type: 'inside', xAxisIndex: 0 },
        {
          type: 'slider',
          xAxisIndex: 0,
          bottom: 6,
          height: 18,
          borderColor: '#2A2A2A',
          backgroundColor: 'rgba(255,255,255,0.02)',
          fillerColor: 'rgba(232,232,232,0.12)',
          handleStyle: { color: CHART_PRIMARY, borderColor: CHART_PRIMARY },
          moveHandleStyle: { color: CHART_PRIMARY },
          textStyle: {
            color: '#888888',
            fontSize: CHART_TEXT_PX.xxs,
            fontFamily: CHART_FONT_MONO,
          },
        },
      ],
      tooltip: {
        trigger: 'axis' as const,
        backgroundColor: 'rgba(20,20,20,0.96)',
        borderColor: '#2A2A2A',
        borderWidth: 1,
        extraCssText: 'z-index: 10 !important; pointer-events: none;',
        padding: [8, 12],
        textStyle: {
          color: '#E8E8E8',
          fontSize: CHART_TEXT_PX.sm,
          fontFamily: CHART_FONT_SANS,
          fontWeight: 500,
        },
        axisPointer: {
          lineStyle: { color: CHART_PRIMARY, width: 1, type: 'dashed' as const },
        },
      },
      series: [
        {
          name: payload.spectrumType || 'Spectrum',
          type: 'line',
          data: seriesData,
          showSymbol: false,
          lineStyle: { color: CHART_PRIMARY, width: 2 },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(232,232,232,0.20)' },
                { offset: 1, color: 'rgba(232,232,232,0)' },
              ],
            },
          },
          markPoint: { data: peakMarkers, animation: false },
          markLine:
            anchorLines.length > 0
              ? {
                  symbol: 'none',
                  silent: true,
                  data: anchorLines,
                  lineStyle: {
                    color: CHART_SECONDARY,
                    width: 1.5,
                    type: 'dashed' as const,
                    opacity: 0.85,
                  },
                  label: { show: false },
                  animation: false,
                }
              : undefined,
        },
      ],
    }),
    [
      payload.xLabel,
      payload.yLabel,
      payload.spectrumType,
      seriesData,
      peakMarkers,
      anchorLines,
    ],
  )

  if (!payload.x.length) {
    return (
      <Card borderless flat className="card-spectrum-root">
        <CardBody>
          <EmptyState compact title="No spectrum data in this artifact" />
        </CardBody>
      </Card>
    )
  }

  return (
    <Card borderless flat className="card-spectrum-root">
      <CardBody>
        <ReactECharts
          ref={(r) => {
            chartRef.current = r
          }}
          key={chartKey}
          option={option}
          notMerge
          className="card-spectrum-echarts"
          opts={{ renderer: 'canvas' }}
        />
      </CardBody>
    </Card>
  )
}

export default memo(SpectrumArtifactCardImpl)
