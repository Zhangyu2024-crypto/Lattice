// Stacked-mode option builder: one subplot per series on a shared
// x-axis range. Lives in its own file because the grid/axis
// bookkeeping dwarfs every other branch of `buildPlotOption`.

import type { PlotPayload } from '../../types/artifact'
import { baseAxisStyle, peakMarkLine, seriesStyle } from './helpers'
import { toLineSeries, toReferenceSeries } from './series'
import type { EChartsOption } from './types'

export function buildStackedOption(
  payload: PlotPayload,
  fontSize: number,
): EChartsOption {
  const { series, params, peaks, references } = payload
  const n = Math.max(series.length, 1)

  // Evenly distribute subplots vertically. Top/bottom margins leave
  // room for the title strip (if any) and the shared x-axis labels.
  const titleReserve = params.title ? 40 : 16
  const bottomReserve = 48
  const gapBetween = 14
  const availableHeight = `calc(100% - ${titleReserve + bottomReserve}px)`
  const grids: Array<Record<string, unknown>> = []
  const xAxes: Array<Record<string, unknown>> = []
  const yAxes: Array<Record<string, unknown>> = []
  const chartSeries: Array<Record<string, unknown>> = []

  for (let i = 0; i < n; i++) {
    // Lay out subplots as percentages — ECharts accepts `top`/`height`
    // as percent strings, which play well with the card's variable
    // height.
    const topPct = ((i / n) * 80 + titleReserve * 0.1).toFixed(2)
    grids.push({
      left: 64,
      right: 24,
      top: `${titleReserve + (i * (100 - titleReserve - bottomReserve)) / n}px`,
      height: `${(100 - titleReserve - bottomReserve) / n - gapBetween}px`,
      containLabel: true,
    })
    void topPct
    void availableHeight

    const s = series[i]
    xAxes.push({
      type: 'value' as const,
      gridIndex: i,
      name: i === n - 1 ? params.xLabel ?? '' : '',
      nameLocation: 'middle' as const,
      nameGap: 28,
      ...baseAxisStyle(fontSize),
      axisLabel: {
        ...baseAxisStyle(fontSize).axisLabel,
        show: i === n - 1,
      },
    })
    yAxes.push({
      type: params.logY ? ('log' as const) : ('value' as const),
      gridIndex: i,
      name: s?.label ?? params.yLabel ?? '',
      nameLocation: 'middle' as const,
      nameGap: 44,
      ...baseAxisStyle(fontSize),
    })
    if (s) {
      chartSeries.push({
        ...toLineSeries(s, seriesStyle(s, i)),
        xAxisIndex: i,
        yAxisIndex: i,
      })
    }
  }

  // Peaks get projected onto every subplot so the vertical guides
  // line up across the stack.
  const peakML = peakMarkLine(peaks)
  if (peakML) {
    for (let i = 0; i < chartSeries.length; i++) {
      ;(chartSeries[i] as { markLine?: unknown }).markLine = peakML
    }
  }

  // References only on the top subplot to avoid clutter.
  references.forEach((ref, i) => {
    chartSeries.push({
      ...toReferenceSeries(ref, i),
      xAxisIndex: 0,
      yAxisIndex: 0,
    })
  })

  const option: EChartsOption = {
    backgroundColor: 'transparent',
    animation: false,
    grid: grids,
    xAxis: xAxes,
    yAxis: yAxes,
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: 'rgba(20,20,20,0.96)',
      borderColor: '#2A2A2A',
      borderWidth: 1,
      extraCssText: 'z-index: 10 !important; pointer-events: none;',
      textStyle: { color: '#E8E8E8', fontSize },
    },
    series: chartSeries,
  }

  if (params.title) {
    option.title = {
      text: params.title,
      left: 'center',
      top: 8,
      textStyle: { color: '#E5E5E5', fontSize: fontSize + 2, fontWeight: 600 },
    }
  }
  if (params.showLegend) {
    option.legend = {
      top: params.title ? 28 : 6,
      right: 12,
      textStyle: { color: '#C8C8C8', fontSize: fontSize - 1 },
      itemWidth: 14,
      itemHeight: 2,
    }
  }

  return option
}
