// ECharts option builder for the interactive `plot` artifact card.
//
// Translates a `PlotPayload` into an option object consumable by
// `echarts-for-react`. Scope is intentionally narrower than
// `publication-style.ts`'s exporter: we render inside the dark app
// chrome (transparent background, muted axis colors), not a
// journal-ready PNG. The same PlotPayload rides through
// `src/lib/spectrum-plot.ts`'s exporter on demand when the user
// clicks Export PNG.
//
// `mode` handling:
//   single       — one line series.
//   overlay      — N line series on a shared axis.
//   offset       — N line series, each offset vertically by
//                  `params.offsetFraction * max(|y|)` per rank.
//   stacked      — one subplot per series, shared x-axis range.
//   difference   — first two series + filled area between them.
//
// `peaks` render as `markLine` verticals with an optional text label at
// the top of each; `references` render as dashed line series so ECharts
// highlights them in the legend without claiming data-axis status.
//
// This file stays the stable public entrypoint. Implementation is
// factored under `plot-chart/`:
//   • types.ts    — shared types + theme constants
//   • helpers.ts  — color / axis / peak-marker helpers
//   • series.ts   — PlotSeries / PlotReference → ECharts series
//   • stacked.ts  — stacked-mode (multi-subplot) option builder

import type {
  PlotMode,
  PlotParams,
  PlotPayload,
} from '../types/artifact'
import {
  baseAxisStyle,
  maxAbsY,
  peakMarkLine,
  pickColor,
  seriesStyle,
} from './plot-chart/helpers'
import { toLineSeries, toReferenceSeries } from './plot-chart/series'
import { buildStackedOption } from './plot-chart/stacked'
import { JOURNAL_FONT_SIZE, type EChartsOption } from './plot-chart/types'

export function buildPlotOption(payload: PlotPayload): EChartsOption {
  const { mode, series, peaks, references, params } = payload
  const fontSize = JOURNAL_FONT_SIZE[params.journalStyle] ?? 12

  // Stacked mode uses an array of grids / axes — one subplot per series.
  // Every other mode uses a single grid.
  if (mode === 'stacked') {
    return buildStackedOption(payload, fontSize)
  }

  const chartSeries: Array<Record<string, unknown>> = []

  if (mode === 'difference') {
    // Expect series[0], series[1], series[2]=A−B (already computed by
    // the tool). Render A + B as plain lines, A−B as filled area for
    // visual emphasis; if series[2] is missing fall through to overlay.
    const [a, b, diff] = series
    if (a) chartSeries.push(toLineSeries(a, seriesStyle(a, 0)))
    if (b) chartSeries.push(toLineSeries(b, seriesStyle(b, 1)))
    if (diff) {
      chartSeries.push({
        ...toLineSeries(diff, seriesStyle(diff, 2)),
        areaStyle: { color: pickColor(diff, 2), opacity: 0.18 },
        lineStyle: { color: pickColor(diff, 2), width: 1.2 },
      })
    }
  } else if (mode === 'offset') {
    // Stack visually by adding a per-series y-step. The step is
    // proportional to the global max amplitude so a small-signal
    // secondary doesn't drown.
    const frac = params.offsetFraction ?? 0.2
    const maxAmp = Math.max(...series.map(maxAbsY), 1)
    const step = frac * maxAmp
    series.forEach((s, i) => {
      const shiftedY = s.y.map((v) => v + i * step)
      chartSeries.push(
        toLineSeries({ ...s, y: shiftedY }, seriesStyle(s, i)),
      )
    })
  } else {
    // single / overlay — each series is just a line.
    series.forEach((s, i) => {
      chartSeries.push(toLineSeries(s, seriesStyle(s, i)))
    })
  }

  // References overlay — one dashed line per reference.
  references.forEach((ref, i) => {
    chartSeries.push(toReferenceSeries(ref, i))
  })

  // Attach peak markers to the first data series so ECharts renders
  // them once (they're not per-series, semantically they belong to the
  // x-axis).
  const peakML = peakMarkLine(peaks)
  if (peakML && chartSeries.length > 0) {
    ;(chartSeries[0] as { markLine?: unknown }).markLine = peakML
  }

  const option: EChartsOption = {
    backgroundColor: 'transparent',
    animation: false,
    grid: {
      top: params.title ? 48 : 28,
      right: 24,
      bottom: 56,
      left: 64,
      containLabel: true,
    },
    xAxis: {
      type: 'value' as const,
      name: params.xLabel ?? '',
      nameLocation: 'middle' as const,
      nameGap: 28,
      ...baseAxisStyle(fontSize),
    },
    yAxis: {
      type: params.logY ? ('log' as const) : ('value' as const),
      name: params.yLabel ?? '',
      nameLocation: 'middle' as const,
      nameGap: 44,
      ...baseAxisStyle(fontSize),
      splitLine: {
        show: params.grid,
        lineStyle: { color: '#2A2A2A', opacity: 0.5 },
      },
    },
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
  if (params.showLegend && chartSeries.length > 1) {
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

/** Default params for a fresh plot. Tools use this as the seed; users
 *  then tune via the drawer. */
export function defaultPlotParams(): PlotParams {
  return {
    title: undefined,
    xLabel: undefined,
    yLabel: undefined,
    logY: false,
    showLegend: true,
    grid: true,
    journalStyle: 'minimal',
    width: 1200,
    height: 720,
    offsetFraction: 0.2,
  }
}

/** Downsample an x/y pair using LTTB-ish stride sampling. Cheap
 *  O(n) pass — for XRD/XPS viewing 3000 points is plenty and keeps
 *  the persist payload under 50 KB per series. Tools call this before
 *  stashing into PlotPayload. */
export function downsampleSeries(
  x: ReadonlyArray<number>,
  y: ReadonlyArray<number>,
  targetPoints = 3000,
): { x: number[]; y: number[]; originalPoints: number } {
  const n = Math.min(x.length, y.length)
  if (n <= targetPoints) {
    return { x: x.slice(0, n), y: y.slice(0, n), originalPoints: n }
  }
  const stride = Math.ceil(n / targetPoints)
  const outX: number[] = []
  const outY: number[] = []
  for (let i = 0; i < n; i += stride) {
    outX.push(x[i])
    outY.push(y[i])
  }
  // Ensure last point is included so the right edge lines up.
  if (outX[outX.length - 1] !== x[n - 1]) {
    outX.push(x[n - 1])
    outY.push(y[n - 1])
  }
  return { x: outX, y: outY, originalPoints: n }
}

void ({} as unknown as PlotMode) // keep PlotMode imported (types-only)
