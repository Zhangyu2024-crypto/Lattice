// Off-screen renderer used by the `plot_spectrum` / `compare_spectra`
// agent tools.
//
// Architecture (post-merge):
//   ParsedSpectrum[] + PlotOptions
//     ↓
//   buildSpectrumChartOption(params)       ← from pro-chart.ts
//     ↓  (base in-app option, grayscale, technique-aware units)
//   applyPublicationStyle(option, preset)  ← from publication-style.ts
//     ↓  (white bg, dark text, title block, journal typography)
//   echarts.init(offscreen, {renderer})
//     ↓
//   PNG (canvas.getDataURL) or SVG (chart.renderToSVGString)
//
// Peaks and reference overlays ride through `buildSpectrumChartOption`
// unchanged — reference curves map to its `overlays` param, peak labels
// map to `XrdProPeak.label` which the option builder already honours.
//
// This file stays the stable public entrypoint. Implementation is
// factored under `spectrum-plot/`:
//   • types.ts          — public types + shared dimensional constants
//   • series.ts         — ParsedSpectrum → option-builder input shaping
//   • option-builder.ts — single-panel + multi-panel ECharts options
//   • render.ts         — offscreen ECharts → PNG / SVG

import type { ParsedSpectrum } from './parsers/types'
import { PRO_CHART_PALETTE } from './pro-chart'
import { type JournalStyle } from './publication-style'
import {
  buildPlotOption,
  composeMultiPanelOption,
} from './spectrum-plot/option-builder'
import { renderOption } from './spectrum-plot/render'
import {
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  type OutputFormat,
  type PanelSpec,
  type PlotOptions,
  type RenderedArtifact,
} from './spectrum-plot/types'

// Re-export public types so external import paths stay
// `@/lib/spectrum-plot`.
export type {
  OutputFormat,
  PeakSpec,
  ReferenceSpec,
  PanelSpec,
  PlotOptions,
  RenderedArtifact,
} from './spectrum-plot/types'
export { buildPlotOption, composeMultiPanelOption }

// ── Extension routing ──────────────────────────────────────────────

export function formatFromPath(outputRelPath: string): OutputFormat {
  if (/\.svg$/i.test(outputRelPath)) return 'svg'
  return 'png'
}

// ── Public render API ──────────────────────────────────────────────

/** Render a single spectrum to PNG bytes or SVG text. */
export async function renderSpectrum(
  spectrum: ParsedSpectrum,
  opts: PlotOptions,
): Promise<RenderedArtifact> {
  const option = buildPlotOption(spectrum, opts)
  return renderOption(option, {
    width: opts.width ?? DEFAULT_WIDTH,
    height: opts.height ?? DEFAULT_HEIGHT,
    pixelRatio: opts.pixelRatio,
    backgroundColor: opts.backgroundColor,
    format: opts.format ?? 'png',
  })
}

/** Render a multi-panel figure. Each PanelSpec produces one subgrid
 *  stacked vertically; the figure-level title is rendered once at the
 *  top. Panel-level titles (PanelSpec.title) become in-panel chart
 *  titles positioned above each subgrid — currently rendered as the
 *  axis-name area's top padding grows to include them. */
export async function renderMultiPanel(
  panels: PanelSpec[],
  opts: Omit<PlotOptions, 'peaks' | 'references'> & {
    /** Figure title (spans the full figure, above all panels). */
    title?: string
  },
): Promise<RenderedArtifact> {
  if (panels.length === 0) {
    throw new Error('renderMultiPanel: need at least 1 panel')
  }
  if (panels.length > 4) {
    throw new Error(
      `renderMultiPanel: supports up to 4 panels, got ${panels.length}. Split the request or choose overlay mode.`,
    )
  }

  const style = opts.journalStyle ?? 'default'
  const panelOptions = panels.map((p) => {
    return buildPlotOption(p.spectrum, {
      width: opts.width ?? DEFAULT_WIDTH,
      height: opts.height ?? DEFAULT_HEIGHT,
      journalStyle: style,
      peaks: p.peaks,
      references: p.references,
      title: p.title,
      logY: p.logY,
      xLabel: p.xLabel,
      yLabel: p.yLabel,
      backgroundColor: opts.backgroundColor,
      showLegend: opts.showLegend,
    })
  })

  const composed = composeMultiPanelOption(panelOptions, {
    title: opts.title,
    journalStyle: style,
    backgroundColor: opts.backgroundColor,
  })

  // Multi-panel figures need taller default height — 300px per panel
  // plus padding — so the user doesn't have to compute by hand.
  const multiHeight = opts.height ?? Math.round(
    Math.max(
      DEFAULT_HEIGHT,
      panels.length * 260 + 80 + (opts.title ? 40 : 0),
    ),
  )

  return renderOption(composed, {
    width: opts.width ?? DEFAULT_WIDTH,
    height: multiHeight,
    pixelRatio: opts.pixelRatio,
    backgroundColor: opts.backgroundColor,
    format: opts.format ?? 'png',
  })
}

// ── Back-compat: the first-cut single-spectrum PNG API used by the
// initial version of `plot_spectrum.ts`. Forwards to `renderSpectrum`
// so callers that still invoke `renderSpectrumToPng` keep working
// during the rollout.

export async function renderSpectrumToPng(
  spectrum: ParsedSpectrum,
  opts: PlotOptions & { style?: 'default' | 'minimal' | 'dark' | 'journal' },
): Promise<ArrayBuffer> {
  // The old `style` knob collapses into `journalStyle` for the default
  // route. `dark` has no direct publication analog — map it to
  // `default` with a dark background override.
  const journalStyle: JournalStyle =
    opts.journalStyle ??
    (opts.style === 'minimal'
      ? 'minimal'
      : opts.style === 'journal'
        ? 'nature'
        : 'default')
  const bg =
    opts.backgroundColor ??
    (opts.style === 'dark' ? '#191919' : undefined)

  const result = await renderSpectrum(spectrum, {
    ...opts,
    journalStyle,
    backgroundColor: bg,
    format: 'png',
  })
  if (result.format !== 'png') throw new Error('renderSpectrumToPng: expected PNG output')
  return result.bytes
}

// Re-export so callers don't need to dip into pro-chart.ts directly.
export { PRO_CHART_PALETTE }
