// Shared types and enum whitelists for the `compare_spectra` tool.
// Broken out so the public tool file stays focused on the execute
// pipeline, and so the helper / renderer modules have a single import
// target for shared shapes.

import type { JournalStyle } from '@/lib/publication-style'

export type CompareMode = 'overlay' | 'offset' | 'stacked' | 'difference'
export type NormaliseMode = 'none' | 'max' | 'area'

export const ALLOWED_MODES: readonly CompareMode[] = [
  'overlay',
  'offset',
  'stacked',
  'difference',
]
export const ALLOWED_NORMALIZE: readonly NormaliseMode[] = ['none', 'max', 'area']
export const ALLOWED_JOURNAL_STYLES: readonly JournalStyle[] = [
  'default',
  'minimal',
  'acs',
  'rsc',
  'nature',
]

export interface Input {
  files: string[]
  mode: CompareMode
  outputRelPath?: string
  normalize?: NormaliseMode
  title?: string
  labels?: string[]
  journalStyle?: JournalStyle
  logY?: boolean
  showLegend?: boolean
  width?: number
  height?: number
  xRange?: [number, number]
}

export interface Output {
  /** Canvas artifact id — this is what the user tunes. Focused on
   *  creation so the comparison opens in front of the user. */
  artifactId: string
  mode: CompareMode
  files: string[]
  points: number
  /** Present only when caller supplied `outputRelPath`. Image was also
   *  written to the workspace so it can be dropped into LaTeX. */
  outputRelPath?: string
  format?: 'png' | 'svg'
  bytes?: number
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
