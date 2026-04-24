// Off-screen rendering paths for `compare_spectra`. Each mode produces
// a `RenderedArtifact` that the caller can persist to the workspace
// (PNG for LaTeX inclusion, SVG for vector-aware pipelines). The
// on-canvas interactive preview is built separately from a
// `PlotPayload` — these renderers only fire when `outputRelPath` is
// supplied.

import type { ParsedSpectrum } from '@/lib/parsers/types'
import { CHART_SERIES_PALETTE } from '@/lib/chart-colors'
import {
  formatFromPath,
  renderMultiPanel,
  renderSpectrum,
  type PanelSpec,
  type ReferenceSpec,
  type RenderedArtifact,
} from '@/lib/spectrum-plot'
import { globalYRange, linearInterpolate } from './helpers'
import type { Input } from './types'

export async function renderOverlayOrOffset(
  mode: 'overlay' | 'offset',
  spectra: ParsedSpectrum[],
  labels: string[],
  opts: Input,
): Promise<{ result: RenderedArtifact; points: number }> {
  // Primary spectrum = first file, overlays = rest. Offset mode adds a
  // vertical shift to each y array so curves don't stack on top of
  // each other.
  const shifted = spectra.map((s, i) => {
    if (mode === 'overlay') return s
    const { max, min } = globalYRange(spectra)
    const shift = (max - min) * 0.35 * i
    return { ...s, y: s.y.map((v) => v + shift) }
  })

  const primary = shifted[0]
  const references: ReferenceSpec[] = shifted.slice(1).map((s, i) => ({
    label: labels[i + 1],
    x: s.x,
    y: s.y,
    color: CHART_SERIES_PALETTE[(i + 1) % CHART_SERIES_PALETTE.length],
    dashed: false,
  }))
  const primaryLabel = labels[0]

  const width = opts.width ?? 1200
  const height = opts.height ?? 720
  const format = opts.outputRelPath
    ? formatFromPath(opts.outputRelPath)
    : 'png'

  // Replace the first series' name via xLabel override? The option
  // builder reads `spectrum.spectrumType`; we can patch that to the
  // label so the legend reads "sample_a" instead of "XPS".
  const primaryWithLabel: ParsedSpectrum = {
    ...primary,
    technique: primary.technique,
    metadata: { ...primary.metadata, sampleName: primaryLabel },
  }

  // The spectrumType on ProWorkbenchSpectrum drives the primary series
  // legend entry (`name: spectrum.spectrumType`). We want the file's
  // label there instead, so stuff the label into that field — it's
  // still a string.
  const patchedSpectrum: ParsedSpectrum = {
    ...primaryWithLabel,
    // Abuse .technique as-is: the base option builder uses
    // `spectrum.spectrumType` for the legend name. We can't mutate
    // `.technique` because TS types constrain it to enum values; the
    // `toWorkbenchSpectrum` helper in spectrum-plot.ts maps this into
    // spectrumType unchanged. Simpler: rely on the metadata-preserved
    // `.xLabel` text — the legend shows `.spectrumType`, so we patch
    // that through an override. Easiest route: post-process the
    // rendered option instead — but renderSpectrum doesn't expose
    // that hook today. Accept technique-named legend for v1; future
    // improvement is to surface `legendName` in PlotOptions.
  }

  const result = await renderSpectrum(patchedSpectrum, {
    width,
    height,
    title: opts.title,
    references,
    journalStyle: opts.journalStyle,
    logY: opts.logY,
    showLegend: opts.showLegend ?? true,
    format,
    yLabel:
      mode === 'offset'
        ? (primary.yLabel ? `${primary.yLabel} (offset)` : 'Intensity (offset)')
        : undefined,
  })
  const totalPoints = spectra.reduce((s, p) => s + p.x.length, 0)
  return { result, points: totalPoints }
}

export async function renderStacked(
  spectra: ParsedSpectrum[],
  labels: string[],
  opts: Input,
): Promise<{ result: RenderedArtifact; points: number }> {
  if (spectra.length > 4) {
    throw new Error(
      `compare_spectra stacked mode supports up to 4 files; got ${spectra.length}.`,
    )
  }
  const panels: PanelSpec[] = spectra.map((s, i) => ({
    spectrum: s,
    title: labels[i],
  }))
  const width = opts.width ?? 1200
  const height =
    opts.height ?? Math.max(720, spectra.length * 260 + (opts.title ? 60 : 20))
  const format = opts.outputRelPath ? formatFromPath(opts.outputRelPath) : 'png'

  const result = await renderMultiPanel(panels, {
    width,
    height,
    title: opts.title,
    journalStyle: opts.journalStyle,
    showLegend: opts.showLegend ?? false,
    format,
  })
  const totalPoints = spectra.reduce((s, p) => s + p.x.length, 0)
  return { result, points: totalPoints }
}

export async function renderDifference(
  spectra: ParsedSpectrum[],
  labels: string[],
  opts: Input,
): Promise<{ result: RenderedArtifact; points: number }> {
  if (spectra.length !== 2) {
    throw new Error(
      `compare_spectra difference mode requires exactly 2 files; got ${spectra.length}.`,
    )
  }
  const [a, b] = spectra
  const bOnA = linearInterpolate(b.x, b.y, a.x)
  const diffY = a.y.map((y, i) => y - bOnA[i])

  const diffSpectrum: ParsedSpectrum = {
    x: a.x,
    y: diffY,
    xLabel: a.xLabel,
    yLabel: `${labels[0]} − ${labels[1]}`,
    technique: a.technique,
    metadata: {
      sourceFile: `${a.metadata.sourceFile ?? ''} − ${b.metadata.sourceFile ?? ''}`,
      format: 'difference',
    },
  }

  const width = opts.width ?? 1200
  const height = opts.height ?? 720
  const format = opts.outputRelPath ? formatFromPath(opts.outputRelPath) : 'png'

  const result = await renderSpectrum(diffSpectrum, {
    width,
    height,
    title: opts.title ?? `${labels[0]} − ${labels[1]}`,
    journalStyle: opts.journalStyle,
    logY: opts.logY,
    showLegend: opts.showLegend ?? false,
    format,
  })
  return { result, points: a.x.length }
}
