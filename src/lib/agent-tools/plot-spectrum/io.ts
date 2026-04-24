// I/O boundary for the `plot_spectrum` tool: Electron `electronAPI`
// handle, workspace file read + parse, and artifact write-out. Kept
// apart from the pure helpers so the renderer / execute modules never
// reach for `window` directly.

import { useWorkspaceStore } from '@/stores/workspace-store'
import {
  canParseLocally,
  needsBinaryRead,
  parseSpectrumBinary,
  parseSpectrumText,
} from '@/lib/parsers/parse-spectrum-file'
import type { ParsedSpectrum } from '@/lib/parsers/types'
import type { RenderedArtifact } from '@/lib/spectrum-plot'
import type { RootFsApi } from './types'

export function rootApi(): RootFsApi {
  const api = (window as unknown as { electronAPI?: unknown }).electronAPI
  if (!api) {
    throw new Error(
      'plot_spectrum requires the Electron shell; run `npm run electron:dev`.',
    )
  }
  const writeBinary = (api as Record<string, unknown>).workspaceWriteBinary
  const write = (api as Record<string, unknown>).workspaceWrite
  if (typeof writeBinary !== 'function' || typeof write !== 'function') {
    throw new Error(
      'plot_spectrum needs workspace IPC — reload the app after upgrading.',
    )
  }
  return api as RootFsApi
}

export async function readAndParse(relPath: string): Promise<ParsedSpectrum> {
  const store = useWorkspaceStore.getState()
  if (!store.rootPath) {
    throw new Error('No workspace root configured. Set it in Settings → Workspace.')
  }
  if (!canParseLocally(relPath)) {
    throw new Error(`Source extension is not supported for spectrum parsing: ${relPath}.`)
  }
  let parsed: ParsedSpectrum | null = null
  if (needsBinaryRead(relPath)) {
    const ab = await store.readBinary(relPath)
    if (!ab) throw new Error(`Could not read binary file: ${relPath}`)
    parsed = await parseSpectrumBinary(ab, relPath)
  } else {
    const text = await store.readFile(relPath)
    if (text == null) throw new Error(`Could not read file: ${relPath}`)
    parsed = await parseSpectrumText(text, relPath)
  }
  if (!parsed) {
    throw new Error(
      `Parser returned no spectrum for ${relPath}. Check devtools console for parser diagnostics.`,
    )
  }
  if (parsed.x.length < 2) {
    throw new Error(`Parsed spectrum for ${relPath} has fewer than 2 points.`)
  }
  return parsed
}

export async function writeArtifact(
  api: RootFsApi,
  relPath: string,
  result: RenderedArtifact,
): Promise<number> {
  if (result.format === 'png') {
    const res = await api.workspaceWriteBinary(relPath, result.bytes)
    if (!res.ok) throw new Error(`Failed to write PNG: ${res.error}`)
    return res.bytes
  }
  const res = await api.workspaceWrite(relPath, result.text)
  if (!res.ok) throw new Error(`Failed to write SVG: ${res.error}`)
  return res.bytes
}
