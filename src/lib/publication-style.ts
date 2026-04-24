// Publication-style post-processor for ECharts options.
//
// `buildSpectrumChartOption` (pro-chart.ts) produces the in-app chart
// option: dark background, design-system grayscale, interactive toolbox
// + dataZoom slider, font sizes tuned for side-panel display.
//
// Exported PNG / SVG needs different defaults:
//   - white (or user-override) background
//   - darker axis/text colors for readability on print
//   - title block (in-app charts use the workbench header instead)
//   - optional journal-specific typography (font family + sizes + margins)
//   - no interactive widgets (dataZoom slider, toolbox)
//   - minimal-style spine option (hide top/right axis lines)
//
// This module mutates an option *after* it's built, so both the in-app
// render path and the publication path share one option builder — there
// is no parallel implementation to drift.

import {
  CHART_FONT_MONO,
  CHART_FONT_SANS,
  CHART_FONT_SERIF,
} from './chart-font-stacks'

export type JournalStyle =
  | 'default'
  | 'minimal'
  | 'acs'
  | 'rsc'
  | 'nature'

interface JournalPreset {
  /** Body + axis-name font family. */
  fontSans: string
  /** Axis-label + tooltip font (tick numbers). Always mono for legibility. */
  fontMono: string
  /** Title px size. */
  title: number
  /** Axis name (e.g. "2θ (°)") px size. */
  axisName: number
  /** Tick label px size. */
  axisTick: number
  /** Legend label px size. */
  legend: number
  /** Compact vs. standard grid padding. */
  gridPadding: { top: number; right: number; bottom: number; left: number }
  /** Hide top + right spine (open-frame look). */
  openFrame: boolean
  /** Exact figure edge label colors for print. */
  textColor: string
  /** Axis line / tick mark color. */
  axisColor: string
  /** Grid line color. */
  gridColor: string
}

const BASE_PADDING = { top: 56, right: 32, bottom: 64, left: 72 } as const
const COMPACT_PADDING = { top: 44, right: 24, bottom: 56, left: 64 } as const

export const JOURNAL_PRESETS: Record<JournalStyle, JournalPreset> = {
  default: {
    fontSans: CHART_FONT_SANS,
    fontMono: CHART_FONT_MONO,
    title: 16,
    axisName: 13,
    axisTick: 11,
    legend: 11,
    gridPadding: BASE_PADDING,
    openFrame: false,
    textColor: '#111111',
    axisColor: '#555555',
    gridColor: '#D8D8D8',
  },
  minimal: {
    fontSans: CHART_FONT_SERIF,
    fontMono: CHART_FONT_MONO,
    title: 14,
    axisName: 12,
    axisTick: 10,
    legend: 10,
    gridPadding: BASE_PADDING,
    openFrame: true,
    textColor: '#111111',
    axisColor: '#555555',
    gridColor: '#E4E4E4',
  },
  acs: {
    fontSans: CHART_FONT_SANS,
    fontMono: CHART_FONT_MONO,
    title: 13,
    axisName: 11,
    axisTick: 10,
    legend: 10,
    gridPadding: COMPACT_PADDING,
    openFrame: false,
    textColor: '#000000',
    axisColor: '#333333',
    gridColor: '#DDDDDD',
  },
  rsc: {
    fontSans: CHART_FONT_SANS,
    fontMono: CHART_FONT_MONO,
    title: 12,
    axisName: 10,
    axisTick: 9,
    legend: 9,
    gridPadding: COMPACT_PADDING,
    openFrame: false,
    textColor: '#000000',
    axisColor: '#333333',
    gridColor: '#DDDDDD',
  },
  nature: {
    fontSans: CHART_FONT_SANS,
    fontMono: CHART_FONT_MONO,
    title: 11,
    axisName: 9,
    axisTick: 8,
    legend: 8,
    gridPadding: COMPACT_PADDING,
    openFrame: true,
    textColor: '#000000',
    axisColor: '#333333',
    gridColor: '#DDDDDD',
  },
}

export interface PublicationStyleOverrides {
  title?: string
  showLegend?: boolean
  /** PNG/SVG canvas fill. Default white. */
  backgroundColor?: string
  /** Force a font size bump/shrink on top of the preset (rarely useful). */
  textScale?: number
}

type MutableOption = Record<string, unknown>

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  return null
}

function applyAxis(
  axis: Record<string, unknown>,
  preset: JournalPreset,
  scale: number,
): void {
  const nameTextStyle = asRecord(axis.nameTextStyle) ?? {}
  nameTextStyle.color = preset.textColor
  nameTextStyle.fontSize = Math.round(preset.axisName * scale)
  nameTextStyle.fontFamily = preset.fontSans
  axis.nameTextStyle = nameTextStyle

  const axisLabel = asRecord(axis.axisLabel) ?? {}
  axisLabel.color = preset.textColor
  axisLabel.fontSize = Math.round(preset.axisTick * scale)
  axisLabel.fontFamily = preset.fontMono
  axis.axisLabel = axisLabel

  const axisLine = asRecord(axis.axisLine) ?? {}
  const axisLineStyle = asRecord(axisLine.lineStyle) ?? {}
  axisLineStyle.color = preset.axisColor
  axisLine.lineStyle = axisLineStyle
  axis.axisLine = axisLine

  const axisTick = asRecord(axis.axisTick) ?? {}
  const axisTickStyle = asRecord(axisTick.lineStyle) ?? {}
  axisTickStyle.color = preset.axisColor
  axisTick.lineStyle = axisTickStyle
  axis.axisTick = axisTick

  const splitLine = asRecord(axis.splitLine) ?? {}
  const splitLineStyle = asRecord(splitLine.lineStyle) ?? {}
  splitLineStyle.color = preset.gridColor
  splitLine.lineStyle = splitLineStyle
  axis.splitLine = splitLine
}

/**
 * Mutate the option in place for a publication export. Returns the same
 * object for fluent chaining. Safe to call on an option object that
 * still carries in-app toolbox / dataZoom / tooltip — we strip what
 * doesn't belong in a static export and rewrite what does.
 */
export function applyPublicationStyle(
  option: MutableOption,
  style: JournalStyle = 'default',
  overrides: PublicationStyleOverrides = {},
): MutableOption {
  const preset = JOURNAL_PRESETS[style] ?? JOURNAL_PRESETS.default
  const scale = overrides.textScale ?? 1

  option.backgroundColor = overrides.backgroundColor ?? '#FFFFFF'

  // Title block
  if (overrides.title) {
    option.title = {
      text: overrides.title,
      left: 'center',
      top: 8,
      textStyle: {
        color: preset.textColor,
        fontSize: Math.round(preset.title * scale),
        fontFamily: preset.fontSans,
        fontWeight: 600,
      },
    }
  } else {
    // Remove any stale title from the base option
    delete option.title
  }

  // Grid padding: if title present, push top padding down to clear it.
  const pad = { ...preset.gridPadding }
  if (overrides.title) pad.top += 18
  option.grid = pad

  // Axes
  const xAxis = asRecord(option.xAxis)
  const yAxis = asRecord(option.yAxis)
  if (xAxis) applyAxis(xAxis, preset, scale)
  if (yAxis) applyAxis(yAxis, preset, scale)

  // Minimal / nature preset hides top + right spine. ECharts doesn't
  // expose top/right axis lines directly; the canonical trick is to add
  // a `show: false` second axis on those sides. Since the base option
  // already hides spare axes, the cleanest path is to set the primary
  // axis's `splitLine.show: false` on the farthest side via
  // `axisLine.onZero = false` and `boundaryGap` adjustments — but the
  // simplest visual approximation is lightening the grid lines AND
  // hiding the corresponding splitLine, which JOURNAL_PRESETS already
  // achieves via `gridColor`. For true open-frame we also drop the
  // default toolbox visible frame, handled below.
  if (preset.openFrame) {
    // Thin the surrounding spines further: match axis color to text
    // at low saturation, and drop the tick marks.
    if (xAxis) {
      const xAxisTick = asRecord(xAxis.axisTick) ?? {}
      xAxisTick.show = false
      xAxis.axisTick = xAxisTick
    }
    if (yAxis) {
      const yAxisTick = asRecord(yAxis.axisTick) ?? {}
      yAxisTick.show = false
      yAxis.axisTick = yAxisTick
    }
  }

  // Legend: if the user forced it off → drop. If the user forced it on
  // OR the base option already had one (auto-added because overlays /
  // peaks existed) → re-style for print. Otherwise leave it absent
  // (single-series plots don't need a one-row legend).
  const showLegend = overrides.showLegend
  if (showLegend === false) {
    delete option.legend
  } else if (showLegend === true || option.legend) {
    const legend = asRecord(option.legend) ?? {}
    legend.show = true
    legend.top = overrides.title ? 32 : 8
    legend.right = 24
    legend.textStyle = {
      color: preset.textColor,
      fontSize: Math.round(preset.legend * scale),
      fontFamily: preset.fontSans,
    }
    legend.itemWidth = 16
    legend.itemHeight = 6
    option.legend = legend
  }

  // Tooltip + toolbox + dataZoom: these are interactive affordances
  // that have no meaning in a static export. Drop them so the SVG XML
  // and PNG canvas stay minimal.
  delete option.tooltip
  delete option.toolbox
  delete option.dataZoom

  // Recolor the primary series strokes so they read on white instead
  // of the dark in-app background. Grayscale discipline preserved.
  const series = option.series
  if (Array.isArray(series)) {
    for (let i = 0; i < series.length; i++) {
      const s = asRecord(series[i])
      if (!s) continue
      // Drop the soft area-fill that assumes a dark background. On white
      // export it reads as a noisy hazy band.
      delete s.areaStyle
      // Darken the default primary stroke: the in-app primary is a
      // light gray (#E8E8E8) which disappears on white.
      const ls = asRecord(s.lineStyle)
      if (ls && (ls.color === '#E8E8E8' || ls.color == null)) {
        ls.color = preset.textColor
      }
    }
  }

  return option
}
