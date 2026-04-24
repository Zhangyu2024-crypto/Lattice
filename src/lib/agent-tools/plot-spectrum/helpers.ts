// Pure helpers for `plot_spectrum`: path utilities, input-shape
// normalisation, series downsampling, and PlotParams derivation. All
// functions here are side-effect-free so they can be unit tested in
// isolation (no workspace I/O, no runtime-store touches).

import type { ParsedSpectrum } from '@/lib/parsers/types'
import { defaultPlotParams } from '@/lib/plot-chart'
import { downsampleSeries } from '@/lib/plot-chart'
import type {
  PeakSpec,
  ReferenceSpec,
} from '@/lib/spectrum-plot'
import type {
  PlotParams,
  PlotPeak,
  PlotReference,
  PlotSeries,
} from '@/types/artifact'
import { ALLOWED_JOURNAL_STYLES, type Input } from './types'

export function basename(relPath: string): string {
  const segs = relPath.split(/[\\/]/)
  return segs[segs.length - 1] || relPath
}

export function replaceExt(relPath: string, newExt: string): string {
  const dot = relPath.lastIndexOf('.')
  const slash = Math.max(relPath.lastIndexOf('/'), relPath.lastIndexOf('\\'))
  const stem = dot > slash ? relPath.slice(0, dot) : relPath
  return stem + newExt
}

/** Normalise input peaks (which can arrive as bare `number[]` for
 *  back-compat or as `{x, label?}` objects) into the PlotPeak shape. */
export function toPlotPeaks(
  input: Array<number | PeakSpec> | undefined,
): PlotPeak[] {
  if (!input) return []
  return input.map((p) =>
    typeof p === 'number' ? { x: p } : { x: p.x, label: p.label },
  )
}

export function toPlotReferences(
  input: ReferenceSpec[] | undefined,
): PlotReference[] {
  if (!input) return []
  return input.map((r) => ({
    x: r.x,
    y: r.y,
    label: r.label,
    color: r.color,
    dashed: r.dashed,
  }))
}

/** Build a PlotSeries from a parsed spectrum, downsampling to keep the
 *  artifact payload persist-friendly. */
export function spectrumToSeries(
  parsed: ParsedSpectrum,
  label: string,
  seriesId: string,
): { series: PlotSeries; xLabel?: string; yLabel?: string } {
  const ds = downsampleSeries(parsed.x, parsed.y)
  return {
    series: {
      id: seriesId,
      x: ds.x,
      y: ds.y,
      label,
      ...(ds.originalPoints > ds.x.length
        ? { downsampledFrom: ds.originalPoints }
        : {}),
    },
    xLabel: parsed.xLabel,
    yLabel: parsed.yLabel,
  }
}

export function buildPlotParams(input: Input): PlotParams {
  const base = defaultPlotParams()
  const journalStyle =
    input.journalStyle && ALLOWED_JOURNAL_STYLES.includes(input.journalStyle)
      ? input.journalStyle
      : base.journalStyle
  return {
    ...base,
    title: input.title ?? base.title,
    xLabel: input.xLabel ?? base.xLabel,
    yLabel: input.yLabel ?? base.yLabel,
    logY: input.logY ?? base.logY,
    showLegend: input.showLegend ?? base.showLegend,
    grid: input.grid ?? base.grid,
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
}
