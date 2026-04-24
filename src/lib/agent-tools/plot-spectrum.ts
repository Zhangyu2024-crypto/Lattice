// Agent tool — `plot_spectrum`. Renders a workspace spectrum file as a
// publication-quality PNG or SVG via the shared off-screen ECharts
// renderer in `spectrum-plot.ts`.
//
// This is the v2 schema. Differences from v1:
//   - Peaks accept either `number[]` (back-compat) OR objects with text
//     labels (`{x, label?}`), wired through the in-app peak marker which
//     already honours `XrdProPeak.label`.
//   - `references: [{label, x, y, dashed?}]` — overlay reference curves
//     (theoretical patterns, database entries) using the same overlay
//     path the XrdAnalysisCard uses in-app.
//   - `panels: PanelSpec[]` — render subplots, up to 4 stacked vertically.
//   - `journalStyle: default | minimal | acs | rsc | nature` — typography
//     presets for the exported file; no new colors (grayscale stays).
//   - `logY`, `showLegend`, `grid` — fine-grained controls.
//   - `.svg` output — ECharts SVG renderer + workspace text IPC.
//
// The option builder is shared with the in-app Pro workbench charts via
// `buildSpectrumChartOption` (see `spectrum-plot.ts`), so the PNG the
// agent exports looks like the chart the user sees in-app, re-styled
// for print.
//
// The concrete implementation is split across ./plot-spectrum/*:
//   - types.ts      shared enums, Input/Output, RootFsApi, InputPanel
//   - helpers.ts    path utils, peak/reference normalisation, params
//   - io.ts         workspace read + artifact write-out + Electron guard
//   - renderers.ts  canvas artifact upsert + optional PNG/SVG side-write
// This file keeps only the public LocalTool wiring and execute flow.

import type { ParsedSpectrum } from '@/lib/parsers/types'
import type { JournalStyle } from '@/lib/publication-style'
import type { LocalTool } from '@/types/agent-tool'
import type {
  PlotPayload,
  PlotPeak,
  PlotReference,
  PlotSeries,
} from '@/types/artifact'
import {
  ALLOWED_JOURNAL_STYLES,
  type Input,
  type InputPanel,
  type Output,
} from './plot-spectrum/types'
import {
  basename,
  buildPlotParams,
  spectrumToSeries,
  toPlotPeaks,
  toPlotReferences,
} from './plot-spectrum/helpers'
import { readAndParse } from './plot-spectrum/io'
import {
  upsertPlotArtifact,
  writeMultiPanelSideExport,
  writeSingleSideExport,
} from './plot-spectrum/renderers'

export const plotSpectrumTool: LocalTool<Input, Output> = {
  name: 'plot_spectrum',
  description:
    'Render a workspace spectrum file (or multi-panel figure) as an INTERACTIVE plot artifact on the canvas. The user can tune title / axes / log-Y / legend / peaks in place — no re-call needed. Optionally also writes a PNG/SVG file to the workspace (pass `outputRelPath`). XPS binding-energy axes invert automatically. Supports peak text labels, reference overlays (theoretical / database curves), subplots (up to 4 panels, mapped to stacked mode), and log-y scale. For single-spectrum plots, pass `relPath`. For stacked subplots, pass `panels: [{relPath, peaks?, references?, ...}, ...]`. Pair with `detect_peaks` to auto-annotate peaks, or with `xrd_search_phases` results to overlay theoretical patterns through `references`. Mention to the user that the plot is on the canvas and tweaks (log-Y, peaks) can be made in place from the right-side drawer.',
  trustLevel: 'localWrite',
  cardMode: 'info',
  inputSchema: {
    type: 'object',
    properties: {
      relPath: {
        type: 'string',
        description:
          'Source spectrum file (workspace-relative). Required unless `panels` is provided.',
      },
      outputRelPath: {
        type: 'string',
        description:
          'Output path. `.png` → raster, `.svg` → vector. Defaults to `<stem>.png` alongside the source.',
      },
      title: {
        type: 'string',
        description: 'Figure title (top-center).',
      },
      peaks: {
        type: 'array',
        description:
          'Peak positions. Either number[] (positions only) or Array<{x:number, label?:string}> (position + optional text label like "Si 2p" / "(104)").',
      },
      references: {
        type: 'array',
        description:
          'Reference curves to overlay. Array<{label:string, x:number[], y:number[], dashed?:boolean, color?:string}>. Use for theoretical phase patterns, database entries, or any comparison curve.',
      },
      panels: {
        type: 'array',
        description:
          'Multi-panel figure — up to 4 stacked vertically. Each panel: {relPath, title?, peaks?, references?, logY?, xLabel?, yLabel?}. When set, top-level `relPath` / `peaks` / `references` are ignored.',
      },
      journalStyle: {
        type: 'string',
        description: 'Typography preset. Default: minimal (clean open-frame). Options: default, minimal.',
      },
      logY: { type: 'boolean', description: 'Log-scale y-axis. Default false.' },
      showLegend: {
        type: 'boolean',
        description:
          'Force-show / force-hide legend. Default auto (shown when overlays or multiple series exist).',
      },
      width: { type: 'number', description: 'Output width in pixels (default 1200).' },
      height: {
        type: 'number',
        description: 'Output height in pixels (default 720; auto-grows for subplots).',
      },
      xLabel: { type: 'string', description: 'Override x-axis label.' },
      yLabel: { type: 'string', description: 'Override y-axis label.' },
      grid: { type: 'boolean', description: 'Show grid split lines. Default true.' },
      style: {
        type: 'string',
        description:
          'v1 compatibility alias — prefer `journalStyle`. `journal` maps to `nature`, `dark` forces a dark background.',
      },
    },
  },
  contextParams: ['sessionId'],
  async execute(input, ctx) {
    const hasPanels = Array.isArray(input?.panels) && input!.panels!.length > 0
    if (!hasPanels && !input?.relPath) {
      throw new Error('plot_spectrum: either `relPath` or `panels` is required.')
    }

    const journalStyle: JournalStyle | undefined =
      input?.journalStyle && ALLOWED_JOURNAL_STYLES.includes(input.journalStyle)
        ? input.journalStyle
        : undefined
    const params = buildPlotParams(input ?? {})

    // Shared artifact-creation path: accumulate parsed spectra, build
    // PlotPayload, upsert, focus. The PNG write (when outputRelPath is
    // passed) runs afterwards — the canvas artifact is the primary
    // product now, the file a secondary export for LaTeX.

    if (hasPanels) {
      const inputPanels = input!.panels!
      if (inputPanels.length > 4) {
        throw new Error(
          `plot_spectrum: up to 4 panels supported; got ${inputPanels.length}.`,
        )
      }
      const parsedPanels: Array<{
        parsed: ParsedSpectrum
        relPath: string
        panelMeta: InputPanel
      }> = []
      let totalPoints = 0
      for (const p of inputPanels) {
        if (!p?.relPath) throw new Error('Each panel needs a relPath.')
        const parsed = await readAndParse(p.relPath)
        totalPoints += parsed.x.length
        parsedPanels.push({ parsed, relPath: p.relPath, panelMeta: p })
      }

      const series: PlotSeries[] = parsedPanels.map(
        ({ parsed, relPath, panelMeta }, i) =>
          spectrumToSeries(
            parsed,
            panelMeta.title ?? basename(relPath),
            `s${i}`,
          ).series,
      )
      // For stacked mode, peaks + refs typically belong to each panel.
      // Agent-facing: use top-level peaks/references as a pan-panel
      // default when per-panel aren't provided.
      const peaks: PlotPeak[] = toPlotPeaks(
        parsedPanels[0]?.panelMeta.peaks ?? input?.peaks,
      )
      const references: PlotReference[] = toPlotReferences(
        parsedPanels[0]?.panelMeta.references ?? input?.references,
      )
      const payload: PlotPayload = {
        mode: 'stacked',
        series,
        peaks,
        references,
        params,
        sourceRelPaths: parsedPanels.map((p) => p.relPath),
      }
      const title = input?.title ?? `Plot — ${series.length} panels`
      const artifact = upsertPlotArtifact(ctx.sessionId, title, payload)

      const sideExport = await writeMultiPanelSideExport(
        input ?? {},
        parsedPanels,
        params,
        journalStyle,
      )

      return {
        artifactId: artifact.id,
        mode: 'stacked',
        width: params.width,
        height: params.height,
        points: totalPoints,
        outputRelPath: sideExport?.outputRelPath,
        format: sideExport?.format,
        bytes: sideExport?.bytes,
        summary:
          `Plotted ${series.length} panels on canvas (${totalPoints} pts)` +
          (sideExport ? ` · also wrote ${basename(sideExport.outputRelPath)}` : ''),
      }
    }

    // ── Single-panel path ─────────────────────────────────────────
    const relPath = input!.relPath!
    const parsed = await readAndParse(relPath)
    const { series: ser0 } = spectrumToSeries(
      parsed,
      basename(relPath),
      's0',
    )
    const payload: PlotPayload = {
      mode: 'single',
      series: [ser0],
      peaks: toPlotPeaks(input?.peaks),
      references: toPlotReferences(input?.references),
      params: {
        ...params,
        xLabel: params.xLabel ?? parsed.xLabel,
        yLabel: params.yLabel ?? parsed.yLabel,
      },
      sourceRelPaths: [relPath],
    }
    const title = input?.title ?? `Plot — ${basename(relPath)}`
    const artifact = upsertPlotArtifact(ctx.sessionId, title, payload)

    const sideExport = await writeSingleSideExport(
      input ?? {},
      parsed,
      params,
      journalStyle,
    )

    const pieces: string[] = [
      `on canvas`,
      `${parsed.x.length} pts`,
    ]
    if (payload.peaks.length > 0) {
      pieces.push(`${payload.peaks.length} peak${payload.peaks.length === 1 ? '' : 's'}`)
    }
    if (payload.references.length > 0) {
      pieces.push(
        `${payload.references.length} reference${payload.references.length === 1 ? '' : 's'}`,
      )
    }
    if (sideExport) pieces.push(`wrote ${basename(sideExport.outputRelPath)}`)

    return {
      artifactId: artifact.id,
      mode: 'single',
      width: params.width,
      height: params.height,
      points: parsed.x.length,
      outputRelPath: sideExport?.outputRelPath,
      format: sideExport?.format,
      bytes: sideExport?.bytes,
      summary: `Plotted ${basename(relPath)} · ${pieces.join(' · ')} — tune log-Y / peaks / style on the right-side drawer.`,
    }
  },
}
