// Artifact-upsert + off-screen side-write paths for `plot_spectrum`.
// The actual figure rendering lives in `@/lib/spectrum-plot`
// (renderSpectrum / renderMultiPanel); this module owns the
// canvas-artifact side (build PlotArtifact envelope, push into runtime
// store, focus it) and the optional workspace PNG/SVG side-write
// (wraps the renderer + writeArtifact IO boundary).

import type { ParsedSpectrum } from '@/lib/parsers/types'
import type { JournalStyle } from '@/lib/publication-style'
import {
  formatFromPath,
  renderMultiPanel,
  renderSpectrum,
  type PanelSpec,
} from '@/lib/spectrum-plot'
import {
  genArtifactId,
  useRuntimeStore,
} from '@/stores/runtime-store'
import type { PlotArtifact, PlotPayload } from '@/types/artifact'
import { rootApi, writeArtifact } from './io'
import type { Input, InputPanel } from './types'

export function upsertPlotArtifact(
  sessionId: string,
  title: string,
  payload: PlotPayload,
): PlotArtifact {
  const now = Date.now()
  const artifact: PlotArtifact = {
    id: genArtifactId(),
    kind: 'plot',
    title,
    createdAt: now,
    updatedAt: now,
    payload,
  }
  const store = useRuntimeStore.getState()
  store.upsertArtifact(sessionId, artifact)
  store.appendArtifactCardMessage(sessionId, artifact.id)
  return artifact
}

export interface SideWriteResult {
  outputRelPath: string
  format: 'png' | 'svg'
  bytes: number
}

/** Write the multi-panel figure as a workspace PNG/SVG file using the
 *  off-screen renderer. Caller is expected to have already resolved
 *  the canvas artifact — this exists only for the LaTeX export. */
export async function writeMultiPanelSideExport(
  input: Input,
  parsedPanels: Array<{ parsed: ParsedSpectrum; panelMeta: InputPanel }>,
  params: { width: number; height: number },
  journalStyle: JournalStyle | undefined,
): Promise<SideWriteResult | undefined> {
  if (!((input.outputRelPath?.trim().length ?? 0) > 0)) return undefined
  const outputRelPath = input.outputRelPath!.trim()
  const format = formatFromPath(outputRelPath)
  const api = rootApi()
  const resolved: PanelSpec[] = parsedPanels.map(({ parsed, panelMeta }) => ({
    spectrum: parsed,
    peaks: panelMeta.peaks,
    references: panelMeta.references,
    title: panelMeta.title,
    logY: panelMeta.logY,
    xLabel: panelMeta.xLabel,
    yLabel: panelMeta.yLabel,
  }))
  const result = await renderMultiPanel(resolved, {
    width: params.width,
    height: params.height,
    journalStyle,
    title: input.title,
    showLegend: input.showLegend,
    format,
  })
  const bytes = await writeArtifact(api, outputRelPath, result)
  return { outputRelPath, format, bytes }
}

/** Single-spectrum equivalent of `writeMultiPanelSideExport`. */
export async function writeSingleSideExport(
  input: Input,
  parsed: ParsedSpectrum,
  params: { width: number; height: number },
  journalStyle: JournalStyle | undefined,
): Promise<SideWriteResult | undefined> {
  if (!((input.outputRelPath?.trim().length ?? 0) > 0)) return undefined
  const outputRelPath = input.outputRelPath!.trim()
  const format = formatFromPath(outputRelPath)
  const api = rootApi()
  const result = await renderSpectrum(parsed, {
    width: params.width,
    height: params.height,
    journalStyle,
    title: input.title,
    peaks: input.peaks,
    references: input.references,
    logY: input.logY,
    xLabel: input.xLabel,
    yLabel: input.yLabel,
    grid: input.grid,
    showLegend: input.showLegend,
    format,
  })
  const bytes = await writeArtifact(api, outputRelPath, result)
  return { outputRelPath, format, bytes }
}
