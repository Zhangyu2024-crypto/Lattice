// Agent tool — `compare_spectra`. Multi-file spectrum comparison,
// porting the shape of lattice-cli's `compare_spectra.py`:
//   - overlay     all curves on one axis
//   - offset      vertically shifted so they don't occlude each other
//   - stacked     one subplot per file (reuses renderMultiPanel)
//   - difference  A − B with fill (exactly 2 files)
//
// Normalisation (`max` / `area`) lines up amplitudes across files that
// use different y-unit conventions (raw counts vs CPS vs normalised).
// Color discipline stays grayscale via `CHART_SERIES_PALETTE`; series
// get distinct `.dashed` styles too so stacked prints stay readable.
//
// The concrete implementation is split across ./compare-spectra/*:
//   - types.ts      shared enums, Input/Output, RootFsApi
//   - helpers.ts    clip / normalise / interpolate / path utilities
//   - io.ts         workspace read + artifact write-out
//   - renderers.ts  overlay|offset / stacked / difference off-screen renders
// This file keeps only the public LocalTool wiring.

import type { ParsedSpectrum } from '@/lib/parsers/types'
import { CHART_SERIES_PALETTE } from '@/lib/chart-colors'
import { formatFromPath, type RenderedArtifact } from '@/lib/spectrum-plot'
import type { LocalTool } from '@/types/agent-tool'
import {
  genArtifactId,
  useRuntimeStore,
} from '@/stores/runtime-store'
import type {
  PlotArtifact,
  PlotMode,
  PlotPayload,
  PlotSeries,
} from '@/types/artifact'
import {
  defaultPlotParams,
  downsampleSeries,
} from '@/lib/plot-chart'
import {
  ALLOWED_JOURNAL_STYLES,
  ALLOWED_MODES,
  ALLOWED_NORMALIZE,
  type Input,
  type Output,
} from './compare-spectra/types'
import {
  basename,
  clipToXRange,
  linearInterpolate,
  normaliseSpectrum,
} from './compare-spectra/helpers'
import { readAndParse, rootApi, writeArtifact } from './compare-spectra/io'
import {
  renderDifference,
  renderOverlayOrOffset,
  renderStacked,
} from './compare-spectra/renderers'

export const compareSpectraTool: LocalTool<Input, Output> = {
  name: 'compare_spectra',
  description:
    'Build an INTERACTIVE multi-file spectrum comparison artifact on the canvas. Modes: `overlay` (all curves on one axis) | `offset` (vertically shifted) | `stacked` (one subplot per file, up to 4) | `difference` (A − B with fill, exactly 2 files). The user can flip mode / log-Y / journal style / labels in place via the right-side drawer — no re-call needed. Optional `normalize` (max / area) lines up amplitudes across instruments. Optional `outputRelPath` also writes a PNG/SVG file to the workspace for LaTeX inclusion. Mention to the user that the plot is on the canvas and layout can be tweaked in place.',
  trustLevel: 'localWrite',
  cardMode: 'info',
  inputSchema: {
    type: 'object',
    properties: {
      files: {
        type: 'array',
        description: 'Workspace-relative spectrum paths. 2-10 files.',
      },
      mode: {
        type: 'string',
        description: `Display mode. One of: ${ALLOWED_MODES.join(', ')}.`,
      },
      outputRelPath: {
        type: 'string',
        description:
          'Output path. `.png` or `.svg`. Defaults to `<first file stem>-compare.<png>`.',
      },
      normalize: {
        type: 'string',
        description: `Amplitude normalisation before plotting. One of: ${ALLOWED_NORMALIZE.join(', ')}. Default 'none'.`,
      },
      title: { type: 'string', description: 'Figure title.' },
      labels: {
        type: 'array',
        description:
          'Legend / panel labels (one per file). Defaults to file basenames.',
      },
      journalStyle: {
        type: 'string',
        description: `Typography preset. One of: ${ALLOWED_JOURNAL_STYLES.join(', ')}.`,
      },
      logY: { type: 'boolean', description: 'Log-scale y-axis.' },
      showLegend: {
        type: 'boolean',
        description: 'Force show/hide legend. Default: on for overlay/offset, off for stacked/difference.',
      },
      width: { type: 'number', description: 'Output width px (default 1200).' },
      height: {
        type: 'number',
        description: 'Output height px. Stacked auto-grows with panel count.',
      },
      xRange: {
        type: 'array',
        description: 'Optional [xMin, xMax] to clip all spectra before comparison.',
      },
    },
    required: ['files', 'mode'],
  },
  contextParams: ['sessionId'],
  async execute(input, ctx) {
    if (!Array.isArray(input?.files) || input.files.length < 2) {
      throw new Error('compare_spectra: need at least 2 files.')
    }
    if (input.files.length > 10) {
      throw new Error(`compare_spectra: up to 10 files supported; got ${input.files.length}.`)
    }
    if (!ALLOWED_MODES.includes(input.mode)) {
      throw new Error(`compare_spectra: mode must be one of ${ALLOWED_MODES.join(', ')}.`)
    }
    const normalize = input.normalize && ALLOWED_NORMALIZE.includes(input.normalize)
      ? input.normalize
      : 'none'
    const xRange = Array.isArray(input.xRange) && input.xRange.length === 2
      ? ([Number(input.xRange[0]), Number(input.xRange[1])] as [number, number])
      : undefined

    // Read + parse + clip + normalize each file.
    const spectra: ParsedSpectrum[] = []
    for (const f of input.files) {
      if (typeof f !== 'string' || f.length === 0) {
        throw new Error('compare_spectra: each file path must be a non-empty string.')
      }
      let s = await readAndParse(f)
      s = clipToXRange(s, xRange)
      s = normaliseSpectrum(s, normalize)
      if (s.x.length < 2) {
        throw new Error(`File ${f} has <2 points after clipping — widen xRange.`)
      }
      spectra.push(s)
    }

    const labels = (input.labels?.length === input.files.length
      ? input.labels
      : input.files.map(basename))

    // ── Build the PlotPayload ─────────────────────────────────────
    // All modes share the same series shape; only the `mode` enum and
    // (for difference) an extra A-B series differ. Reusing the palette
    // keeps colours stable between the inline ECharts view and the
    // optional PNG export.
    const series: PlotSeries[] = spectra.map((s, i) => {
      const ds = downsampleSeries(s.x, s.y)
      return {
        id: `s${i}`,
        x: ds.x,
        y: ds.y,
        label: labels[i],
        color: CHART_SERIES_PALETTE[i % CHART_SERIES_PALETTE.length],
        ...(ds.originalPoints > ds.x.length
          ? { downsampledFrom: ds.originalPoints }
          : {}),
      }
    })

    let plotSeries: PlotSeries[] = series
    let totalPoints = spectra.reduce((acc, s) => acc + s.x.length, 0)
    const plotMode: PlotMode = input.mode
    if (input.mode === 'difference') {
      if (spectra.length !== 2) {
        throw new Error(
          `compare_spectra difference mode requires exactly 2 files; got ${spectra.length}.`,
        )
      }
      const [a, b] = spectra
      const bOnA = linearInterpolate(b.x, b.y, a.x)
      const diffY = a.y.map((y, i) => y - bOnA[i])
      const ds = downsampleSeries(a.x, diffY)
      plotSeries = [
        ...series,
        {
          id: 'diff',
          x: ds.x,
          y: ds.y,
          label: `${labels[0]} − ${labels[1]}`,
          color: CHART_SERIES_PALETTE[2 % CHART_SERIES_PALETTE.length],
          ...(ds.originalPoints > ds.x.length
            ? { downsampledFrom: ds.originalPoints }
            : {}),
        },
      ]
    }

    // Shared params seed — drawer mutates these post-hoc.
    const base = defaultPlotParams()
    const journalStyle =
      input.journalStyle && ALLOWED_JOURNAL_STYLES.includes(input.journalStyle)
        ? input.journalStyle
        : base.journalStyle
    const params = {
      ...base,
      title: input.title ?? base.title,
      xLabel: spectra[0]?.xLabel ?? base.xLabel,
      yLabel:
        input.mode === 'difference'
          ? `${labels[0]} − ${labels[1]}`
          : spectra[0]?.yLabel ?? base.yLabel,
      logY: input.logY ?? base.logY,
      showLegend:
        input.showLegend ??
        (input.mode === 'stacked' || input.mode === 'difference'
          ? false
          : base.showLegend),
      grid: base.grid,
      journalStyle,
      width:
        Number.isFinite(input.width) && (input.width as number) > 0
          ? Math.round(input.width as number)
          : base.width,
      height:
        Number.isFinite(input.height) && (input.height as number) > 0
          ? Math.round(input.height as number)
          : base.height,
    }

    const payload: PlotPayload = {
      mode: plotMode,
      series: plotSeries,
      peaks: [],
      references: [],
      params,
      sourceRelPaths: input.files,
    }

    const now = Date.now()
    const title = input.title ?? `Compare — ${labels.join(' + ')}`
    const artifact: PlotArtifact = {
      id: genArtifactId(),
      kind: 'plot',
      title,
      createdAt: now,
      updatedAt: now,
      payload,
    }
    const store = useRuntimeStore.getState()
    store.upsertArtifact(ctx.sessionId, artifact)
    store.focusArtifact(ctx.sessionId, artifact.id)

    // Optional PNG side-write (for LaTeX / paper submission workflows).
    let outRel: string | undefined
    let bytes: number | undefined
    let format: 'png' | 'svg' | undefined
    if (input.outputRelPath?.trim().length) {
      outRel = input.outputRelPath.trim()
      format = formatFromPath(outRel)
      // We still call the off-screen renderer here so the PNG matches
      // the old spec (journal-grade typography, white bg). The canvas
      // view stays grayscale-on-dark per design canon.
      let rendered: { result: RenderedArtifact; points: number }
      switch (input.mode) {
        case 'overlay':
        case 'offset':
          rendered = await renderOverlayOrOffset(input.mode, spectra, labels, input)
          break
        case 'stacked':
          rendered = await renderStacked(spectra, labels, input)
          break
        case 'difference':
          rendered = await renderDifference(spectra, labels, input)
          break
      }
      if (rendered.result.format !== format) {
        throw new Error(
          `compare_spectra internal format mismatch (rendered ${rendered.result.format}, output ${format}).`,
        )
      }
      const api = rootApi()
      bytes = await writeArtifact(api, outRel, rendered.result)
      totalPoints = rendered.points
    }

    const summaryPieces: string[] = [
      `on canvas · ${input.mode}`,
      `${input.files.length} files`,
      `${totalPoints} pts total`,
    ]
    if (normalize !== 'none') summaryPieces.push(`normalize=${normalize}`)
    if (outRel) summaryPieces.push(`wrote ${outRel}`)

    return {
      artifactId: artifact.id,
      mode: input.mode,
      files: input.files,
      points: totalPoints,
      outputRelPath: outRel,
      format,
      bytes,
      summary: `Compared ${input.files.length} spectra · ${summaryPieces.join(' · ')} — flip mode / log-Y / legend on the right-side drawer.`,
    }
  },
}
