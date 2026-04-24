// Shared ECharts option builder used by every Pro workbench chart.
//
// Centralises neutral-axis styling plus grayscale series tokens so
// workbenches only supply data + overlays. CJK font fallbacks are
// appended for localised axis labels.

import type { ProWorkbenchSpectrum, XrdProPeak } from '../types/artifact'
import {
  CHART_GRID,
  CHART_PRIMARY,
  CHART_QUATERNARY,
  CHART_QUINARY,
  CHART_SECONDARY,
  CHART_TERTIARY,
} from './chart-colors'
import { buildPeakMarker } from './chart-peak-markers'
import { formatUnit, type Technique } from './pro-chart-format'
import { CHART_FONT_MONO, CHART_FONT_SANS } from './chart-font-stacks'
import { CHART_TEXT_PX } from './chart-text-px'

const MONO_STACK = CHART_FONT_MONO
const SANS_STACK = CHART_FONT_SANS

const G6 = '#C8C8C8'
const G7 = '#A0A0A0'

/**
 * Back-compat colour constants.
 *
 * Legacy callers reach into this object for overlay colours. Keys are
 * stable; values are grayscale luminance steps.
 */
export const PRO_CHART_COLORS = {
  primary: CHART_PRIMARY,
  secondary: CHART_SECONDARY,
  grid: CHART_GRID,
  axis: '#2A2A2A',
  axisLabel: '#888888',
  nameLabel: '#999999',
  tooltip: 'rgba(20,20,20,0.96)',
  residual: CHART_TERTIARY,
  model: CHART_SECONDARY,
} as const

/** Flat palette in priority order (used for auto-assigning overlay colours). */
export const PRO_CHART_PALETTE = [
  CHART_PRIMARY,
  CHART_SECONDARY,
  CHART_TERTIARY,
  CHART_QUATERNARY,
  CHART_QUINARY,
  G6,
  G7,
] as const

/**
 * Per-technique token map.
 *
 * Each entry names the four semantic roles every Pro workbench chart
 * uses (primary spectrum trace, peak markers, model / envelope, residual
 * delta) plus a fallback overlay rotation. Workbenches should pull from
 * here instead of reaching into raw hex codes so the palette stays
 * grayscale at one edit point.
 */
export const PRO_CHART_TOKENS = {
  raman: {
    spectrum: CHART_PRIMARY,
    peak: CHART_SECONDARY,
    model: CHART_TERTIARY,
    residual: CHART_QUATERNARY,
    overlay: [CHART_QUINARY, G6, G7, CHART_TERTIARY],
  },
  xrd: {
    spectrum: CHART_PRIMARY,
    peak: CHART_SECONDARY,
    model: CHART_TERTIARY,
    residual: CHART_QUATERNARY,
    overlay: [CHART_QUINARY, G6, G7, CHART_TERTIARY],
  },
  xps: {
    spectrum: CHART_PRIMARY,
    peak: CHART_SECONDARY,
    model: CHART_TERTIARY,
    residual: CHART_QUATERNARY,
    overlay: [CHART_QUINARY, G6, G7, CHART_TERTIARY],
  },
  ftir: {
    spectrum: CHART_PRIMARY,
    peak: CHART_SECONDARY,
    model: CHART_TERTIARY,
    residual: CHART_QUATERNARY,
    overlay: [CHART_QUINARY, G6, G7, CHART_TERTIARY],
  },
} as const

export interface BuildChartOptionsParams {
  spectrum: ProWorkbenchSpectrum | null
  peaks?: XrdProPeak[]
  reverseX?: boolean
  overlays?: Array<{
    name: string
    x: number[]
    y: number[]
    color: string
    width?: number
    dashed?: boolean
  }>
  onClickSupported?: boolean
  /** When provided, tooltip / axis formatters use the technique's unit
   *  conventions (e.g. `32.105°` for XRD, `284.62 eV` for XPS). */
  technique?: Technique | string
  /** Index of the peak currently focused in the DataTab peak table. Boosts
   *  that marker's symbol size + stroke tint so the chart reflects the row
   *  under the user's pointer without waiting for a full hover event. */
  focusedPeakIdx?: number | null
  /** Log-scale y-axis. Default false — linear. Used by the publication
   *  exporter for XPS/XRD dynamic-range views; safe for in-app callers
   *  that opt in per-chart. */
  logY?: boolean
}

/** Minimal empty option with no series — used when neither a primary
 *  spectrum nor any overlays are available, so ECharts can still mount
 *  cleanly without throwing on missing axis extents. */
function emptyOption() {
  return {
    backgroundColor: 'transparent',
    animation: false,
    grid: { top: 40, right: 28, bottom: 80, left: 68 },
    xAxis: { type: 'value' as const },
    yAxis: { type: 'value' as const },
    series: [] as Array<Record<string, unknown>>,
  }
}

function allPositive(values: readonly number[]): boolean {
  for (let i = 0; i < values.length; i++) {
    if (!(values[i] > 0)) return false
  }
  return values.length > 0
}

export function buildSpectrumChartOption(params: BuildChartOptionsParams) {
  const {
    spectrum,
    peaks = [],
    reverseX = false,
    overlays = [],
    focusedPeakIdx,
    logY = false,
  } = params

  // ─── Null-spectrum guards ─────────────────────────────────────────
  // When no data at all has landed, avoid building a fully-styled option
  // that ECharts would render as an empty box with phantom axes.
  if (!spectrum && overlays.length === 0) return emptyOption()

  // Only keep overlays whose coordinate arrays line up — a mismatched
  // pair usually means a stale / still-loading calc curve and would
  // otherwise crash inside ECharts' line-series renderer.
  const safeOverlays = overlays.filter(
    (o) =>
      Array.isArray(o.x) &&
      Array.isArray(o.y) &&
      o.x.length > 0 &&
      o.x.length === o.y.length,
  )

  // Narrow the technique hint to a known Technique for formatUnit calls.
  // Unknown values (or undefined) fall back to raw numeric formatting.
  const technique: Technique | null = (() => {
    const raw = params.technique
    if (!raw) return null
    const t = String(raw).toLowerCase()
    if (t === 'xrd' || t === 'xps' || t === 'raman' || t === 'ftir') return t
    return null
  })()

  const peakColor =
    (technique && PRO_CHART_TOKENS[technique]?.peak) || PRO_CHART_COLORS.secondary
  const formatPeakName = (p: XrdProPeak): string => {
    if (p.label) return p.label
    if (technique) return formatUnit(technique, 'x', p.position)
    return p.position.toFixed(1)
  }
  const peakMarkers = peaks.map((p, i) => {
    const focused = focusedPeakIdx != null && focusedPeakIdx === i
    return buildPeakMarker({
      x: p.position,
      y: p.intensity,
      name: formatPeakName(p),
      // Focused peak picks up the design-system accent (`#E5E5E5`) so it
      // stands out without breaking the grayscale-only rule.
      color: focused ? '#E5E5E5' : peakColor,
      symbolSize: focused ? 14 : 10,
      symbolOffsetY: focused ? -10 : -7,
      labelFontSize: focused ? 11 : 10,
      labelDistance: 6,
    })
  })

  const series: Array<Record<string, unknown>> = []
  // Log axes are only valid for strictly-positive plotted values. Fall back
  // to linear silently when the current trace/overlay set includes zeros or
  // negatives (common after baseline subtraction or residual overlays).
  const canUseLogY =
    logY &&
    [
      ...(spectrum ? [spectrum.y] : []),
      ...safeOverlays.map((o) => o.y),
    ].every((ys) => allPositive(ys))
  if (spectrum) {
    series.push({
      name: spectrum.spectrumType ?? 'Spectrum',
      type: 'line',
      data: spectrum.x.map((x, i) => [x, spectrum.y[i]]),
      showSymbol: false,
      sampling: 'lttb',
      lineStyle: { color: PRO_CHART_COLORS.primary, width: 2 },
      areaStyle: {
        color: {
          type: 'linear',
          x: 0,
          y: 0,
          x2: 0,
          y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(0,114,178,0.22)' },
            { offset: 1, color: 'rgba(0,114,178,0)' },
          ],
        },
      },
      markPoint: peakMarkers.length > 0
        ? { data: peakMarkers, animation: false }
        : undefined,
      z: 2,
    })
  }
  for (const o of safeOverlays) {
    series.push({
      name: o.name,
      type: 'line',
      data: o.x.map((x, i) => [x, o.y[i]]),
      showSymbol: false,
      sampling: 'lttb',
      lineStyle: {
        color: o.color,
        width: o.width ?? 1.2,
        type: o.dashed ? 'dashed' : 'solid',
      },
      // Fit / reference overlays must sit above the observed spectrum's
      // filled area or they effectively disappear when the traces overlap.
      z: 3,
    })
  }

  // Peaks-only placeholder series: when there's no primary spectrum and
  // no overlay but we do have detected peaks, we still want a legend
  // entry so users can tell the chart is intentionally sparse rather
  // than broken. ECharts requires at least one data point in the series
  // for it to show up in the legend; a single off-screen NaN-adjacent
  // coord is the minimum-impact way to achieve that.
  const hasSpectrumSeries = spectrum != null
  if (!hasSpectrumSeries && peakMarkers.length > 0) {
    series.push({
      name: 'Peaks',
      type: 'scatter',
      data: [],
      showSymbol: true,
      markPoint: { data: peakMarkers, animation: false },
      itemStyle: { color: PRO_CHART_COLORS.secondary },
      z: 2,
    })
  }

  // ─── Graphic callouts ────────────────────────────────────────────
  // Surface a gentle hint when overlays are rendered without a
  // primary spectrum. We keep this as a chart `graphic` rather than an
  // HTML overlay so it respects dataZoom / export-to-PNG the same way
  // the trace itself does.
  const graphic: Array<Record<string, unknown>> = []
  if (!spectrum && safeOverlays.length > 0) {
    graphic.push({
      type: 'text',
      left: 'center',
      top: 14,
      style: {
        text: 'Overlay without primary spectrum',
        fill: PRO_CHART_COLORS.axisLabel,
        fontFamily: SANS_STACK,
        fontSize: CHART_TEXT_PX.xs,
        fontWeight: 500,
      },
      silent: true,
    })
  }

  // Always emit a legend when there is *anything* meaningful to label —
  // overlays or peaks. This keeps the UI predictable across fit /
  // detect toggles; the old behaviour (conditional on overlays>0) hid
  // the "Peaks" entry for detect-only flows.
  const showLegend = safeOverlays.length > 0 || peakMarkers.length > 0

  // Default tooltip valueFormatter: when a technique is known, route to
  // the canonical unit formatter so 2θ rounds to three decimals, BE to
  // two, wavenumbers to one, etc. Callers without a technique hint get
  // raw numbers untouched so legacy workbenches don't regress.
  const valueFormatter = technique
    ? (value: unknown) =>
        typeof value === 'number'
          ? formatUnit(technique, 'y', value)
          : String(value ?? '')
    : undefined

  return {
    backgroundColor: 'transparent',
    animation: false,
    grid: { top: 40, right: 28, bottom: 80, left: 68 },
    legend: showLegend
      ? {
          show: true,
          top: 6,
          right: 16,
          textStyle: {
            color: PRO_CHART_COLORS.axisLabel,
            fontSize: CHART_TEXT_PX.xxs,
            fontFamily: SANS_STACK,
          },
          itemWidth: 14,
          itemHeight: 6,
        }
      : undefined,
    xAxis: {
      type: 'value' as const,
      name: spectrum?.xLabel ?? '',
      nameLocation: 'middle' as const,
      nameGap: 36,
      inverse: reverseX,
      nameTextStyle: {
        color: PRO_CHART_COLORS.nameLabel,
        fontSize: CHART_TEXT_PX.sm,
        fontFamily: SANS_STACK,
        fontWeight: 500,
      },
      axisLabel: {
        color: PRO_CHART_COLORS.axisLabel,
        fontSize: CHART_TEXT_PX.sm,
        fontFamily: MONO_STACK,
        fontWeight: 500,
      },
      axisLine: { lineStyle: { color: PRO_CHART_COLORS.axis } },
      axisTick: { lineStyle: { color: PRO_CHART_COLORS.axis } },
      splitLine: {
        lineStyle: { color: PRO_CHART_COLORS.grid, type: 'dashed' as const },
      },
    },
    yAxis: {
      type: (canUseLogY ? 'log' : 'value') as 'value' | 'log',
      name: spectrum?.yLabel ?? '',
      nameLocation: 'middle' as const,
      nameGap: 52,
      nameTextStyle: {
        color: PRO_CHART_COLORS.nameLabel,
        fontSize: CHART_TEXT_PX.sm,
        fontFamily: SANS_STACK,
        fontWeight: 500,
      },
      axisLabel: {
        color: PRO_CHART_COLORS.axisLabel,
        fontSize: CHART_TEXT_PX.sm,
        fontFamily: MONO_STACK,
        fontWeight: 500,
      },
      axisLine: { lineStyle: { color: PRO_CHART_COLORS.axis } },
      axisTick: { lineStyle: { color: PRO_CHART_COLORS.axis } },
      splitLine: {
        lineStyle: { color: PRO_CHART_COLORS.grid, type: 'dashed' as const },
      },
    },
    dataZoom: [
      { type: 'inside', xAxisIndex: 0 },
      {
        type: 'slider',
        xAxisIndex: 0,
        bottom: 6,
        height: 18,
        borderColor: PRO_CHART_COLORS.axis,
        backgroundColor: 'rgba(255,255,255,0.02)',
        fillerColor: 'rgba(0,114,178,0.15)',
        handleStyle: {
          color: PRO_CHART_COLORS.primary,
          borderColor: PRO_CHART_COLORS.primary,
        },
        moveHandleStyle: { color: PRO_CHART_COLORS.primary },
        textStyle: {
          color: PRO_CHART_COLORS.axisLabel,
          fontSize: CHART_TEXT_PX.xxs,
          fontFamily: MONO_STACK,
        },
      },
    ],
    // Toolbox: only the restore (reset-zoom) action — keeps the chart
    // focused but gives power users an obvious way to recover after a
    // deep zoom. Sits next to the slider on the top-right; the slider
    // stays responsive because the toolbox doesn't capture dataZoom.
    toolbox: { show: false },
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: PRO_CHART_COLORS.tooltip,
      borderColor: PRO_CHART_COLORS.axis,
      borderWidth: 1,
      extraCssText: 'z-index: 10 !important; pointer-events: none;',
      padding: [8, 12],
      textStyle: {
        color: '#E8E8E8',
        fontSize: CHART_TEXT_PX.sm,
        fontFamily: MONO_STACK,
        fontWeight: 500,
      },
      axisPointer: {
        lineStyle: {
          color: PRO_CHART_COLORS.primary,
          width: 1,
          type: 'dashed' as const,
        },
      },
      ...(valueFormatter ? { valueFormatter } : {}),
    },
    graphic: graphic.length > 0 ? graphic : undefined,
    series,
  }
}
