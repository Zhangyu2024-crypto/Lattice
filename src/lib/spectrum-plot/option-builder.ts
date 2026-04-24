// ECharts option assembly: single-panel builder + multi-panel composer.
//
// Single-panel path:
//   buildPlotOption  =  buildSpectrumChartOption (base)
//                    +  applyPublicationStyle    (journal theme)
//
// Multi-panel path:
//   composeMultiPanelOption remaps N single-panel options into
//   grid/axis arrays with aligned gridIndex so one ECharts instance
//   renders them stacked vertically.

import type { ParsedSpectrum } from '../parsers/types'
import { buildSpectrumChartOption } from '../pro-chart'
import {
  applyPublicationStyle,
  type JournalStyle,
} from '../publication-style'
import {
  toBaseOverlays,
  toProPeaks,
  toWorkbenchSpectrum,
  techniqueReverseX,
  techniqueToKind,
} from './series'
import { DEFAULT_HEIGHT, INTER_PANEL_GAP_PX, type PlotOptions } from './types'

/** Build a single-panel publication option. Wraps
 *  `buildSpectrumChartOption` + `applyPublicationStyle` so the agent
 *  tool and the in-app workbench chart stay on the same option builder.
 */
export function buildPlotOption(
  spectrum: ParsedSpectrum,
  opts: PlotOptions,
): Record<string, unknown> {
  const base = buildSpectrumChartOption({
    spectrum: toWorkbenchSpectrum(spectrum),
    peaks: toProPeaks(spectrum, opts.peaks),
    reverseX: techniqueReverseX(spectrum),
    overlays: toBaseOverlays(opts.references),
    technique: techniqueToKind(spectrum.technique),
    logY: opts.logY,
  }) as Record<string, unknown>

  // Override axis names when the user passed explicit labels.
  const xAxis = base.xAxis as Record<string, unknown> | undefined
  const yAxis = base.yAxis as Record<string, unknown> | undefined
  if (xAxis && opts.xLabel !== undefined) xAxis.name = opts.xLabel
  if (yAxis && opts.yLabel !== undefined) yAxis.name = opts.yLabel
  if (opts.grid === false) {
    if (xAxis) xAxis.splitLine = { show: false }
    if (yAxis) yAxis.splitLine = { show: false }
  }

  return applyPublicationStyle(base, opts.journalStyle ?? 'default', {
    title: opts.title,
    showLegend: opts.showLegend,
    backgroundColor: opts.backgroundColor,
  })
}

/** Merge N single-panel options into one multi-grid option. Each input
 *  must be a flat `{grid, xAxis, yAxis, series, ...}` shape — the
 *  output remaps them to grid/axis arrays with aligned indices so one
 *  ECharts instance renders them stacked vertically. */
export function composeMultiPanelOption(
  panels: Array<Record<string, unknown>>,
  opts: { title?: string; journalStyle?: JournalStyle; backgroundColor?: string },
): Record<string, unknown> {
  if (panels.length === 0) {
    throw new Error('composeMultiPanelOption: need at least 1 panel')
  }

  // We ditch each panel's own title (we render a single figure title at
  // the top) and each panel's own dataZoom/toolbox (already stripped by
  // applyPublicationStyle but defensive here too).
  const n = panels.length
  const topOffset = opts.title ? 44 : 16
  const bottomOffset = 54

  const grids: Array<Record<string, unknown>> = []
  const xAxes: Array<Record<string, unknown>> = []
  const yAxes: Array<Record<string, unknown>> = []
  const series: Array<Record<string, unknown>> = []
  const legendNames: string[] = []

  const totalVertical = DEFAULT_HEIGHT - topOffset - bottomOffset
  const perPanelHeight = (totalVertical - INTER_PANEL_GAP_PX * (n - 1)) / n

  for (let i = 0; i < n; i++) {
    const p = panels[i]
    const top = topOffset + i * (perPanelHeight + INTER_PANEL_GAP_PX)

    // Pluck axis/series from each panel, reindex to this grid slot.
    const xAxis: Record<string, unknown> = {
      ...(p.xAxis as Record<string, unknown>),
      gridIndex: i,
    }
    const yAxis: Record<string, unknown> = {
      ...(p.yAxis as Record<string, unknown>),
      gridIndex: i,
    }
    // Only the bottom panel shows an x-axis name; inner panels drop
    // their name label to avoid redundant clutter.
    if (i < n - 1) xAxis.name = ''
    xAxes.push(xAxis)
    yAxes.push(yAxis)
    grids.push({
      left: 72,
      right: 32,
      top,
      height: perPanelHeight,
      containLabel: false,
    })

    const panelSeries = p.series as Array<Record<string, unknown>> | undefined
    if (Array.isArray(panelSeries)) {
      for (const s of panelSeries) {
        const copy = { ...s, xAxisIndex: i, yAxisIndex: i }
        series.push(copy)
        const name = s.name
        if (typeof name === 'string') legendNames.push(name)
      }
    }
  }

  const out: Record<string, unknown> = {
    backgroundColor: opts.backgroundColor ?? '#FFFFFF',
    animation: false,
    grid: grids,
    xAxis: xAxes,
    yAxis: yAxes,
    series,
  }
  if (opts.title) {
    out.title = {
      text: opts.title,
      left: 'center',
      top: 8,
      textStyle: {
        color: '#111111',
        fontSize: 16,
        fontWeight: 600,
      },
    }
  }
  return out
}
