// Shared types and enum whitelists for the `plot_spectrum` tool.
// Broken out so the public tool file stays focused on the execute
// pipeline, and so the helper / renderer / io modules have a single
// import target for shared shapes.

import type { PeakSpec, ReferenceSpec } from '@/lib/spectrum-plot'
import type { JournalStyle } from '@/lib/publication-style'

export const ALLOWED_JOURNAL_STYLES: readonly JournalStyle[] = [
  'default',
  'minimal',
  'acs',
  'rsc',
  'nature',
]

export interface InputPanel {
  relPath: string
  title?: string
  peaks?: Array<number | PeakSpec>
  references?: ReferenceSpec[]
  logY?: boolean
  xLabel?: string
  yLabel?: string
}

export interface Input {
  relPath?: string
  outputRelPath?: string
  title?: string
  peaks?: Array<number | PeakSpec>
  references?: ReferenceSpec[]
  panels?: InputPanel[]
  journalStyle?: JournalStyle
  logY?: boolean
  showLegend?: boolean
  width?: number
  height?: number
  xLabel?: string
  yLabel?: string
  grid?: boolean
  // Back-compat knob from v1: maps to a journalStyle in the renderer.
  style?: 'default' | 'minimal' | 'dark' | 'journal'
}

export interface Output {
  /** Canvas artifact id — this is what the user tunes. Focused
   *  automatically on creation so the chart opens in front of them. */
  artifactId: string
  /** Layout mode the artifact card was configured with (`single` for a
   *  bare plot, `stacked` for a multi-panel deck). */
  mode: import('@/types/artifact').PlotMode
  /** Present only when the caller supplied `outputRelPath` — we write a
   *  workspace PNG alongside the canvas artifact so the file can be
   *  dropped into LaTeX. Absent otherwise. */
  outputRelPath?: string
  format?: 'png' | 'svg'
  bytes?: number
  width: number
  height: number
  points: number
  summary: string
}

export interface RootFsApi {
  workspaceWriteBinary: (
    rel: string,
    data: ArrayBuffer,
  ) => Promise<{ ok: true; bytes: number } | { ok: false; error: string }>
  workspaceWrite: (
    rel: string,
    content: string,
  ) => Promise<{ ok: true; bytes: number } | { ok: false; error: string }>
}
