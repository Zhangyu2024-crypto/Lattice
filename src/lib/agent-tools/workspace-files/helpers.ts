// Shared helpers for the workspace-files agent tools: Electron / root
// guards, IPC casts, glob → RegExp translation, workspace walks, and
// small string utilities. Kept free of tool wiring so each tool file
// stays narrowly focused on its LocalTool definition.

import { useWorkspaceStore } from '@/stores/workspace-store'
import {
  IPC_UNAVAILABLE,
  MAX_GLOB_RESULTS,
  NO_WORKSPACE_ROOT,
  type RootFsApi,
  type RootFsEntry,
} from './types'

export function ensureRoot(): void {
  if (typeof window === 'undefined' || !window.electronAPI) {
    throw new Error(IPC_UNAVAILABLE)
  }
  if (!useWorkspaceStore.getState().rootPath) {
    throw new Error(NO_WORKSPACE_ROOT)
  }
}

export function rootApi(): RootFsApi {
  const api = window.electronAPI as unknown as Record<string, unknown>
  return api as unknown as RootFsApi
}

/** Simple glob → RegExp translator. Supports double-star, single-star,
 *  and `?`. `**​/` is treated as "zero or more directory segments" so
 *  `**​/*.raw` matches both `foo.raw` (root) and `dir/foo.raw` — matching
 *  minimatch / git glob semantics. A bare `**` (no trailing slash) still
 *  collapses to `.*` for backward compatibility. */
export function matchesGlob(relPath: string, pattern: string): boolean {
  const re = new RegExp(
    '^' +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*\//g, '§§§')
        .replace(/\*\*/g, '§§')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]')
        .replace(/§§§/g, '(?:.*/)?')
        .replace(/§§/g, '.*') +
      '$',
  )
  return re.test(relPath)
}

/** Depth-first walk of the workspace root via the list IPC. Silently
 *  skips directories it cannot list (permission-denied, etc.). Caps at
 *  MAX_GLOB_RESULTS so a bad root doesn't spin forever. */
export async function listFilesInRoot(): Promise<string[]> {
  const out: string[] = []
  const stack: string[] = ['']
  while (stack.length > 0) {
    const rel = stack.pop() as string
    let entries: RootFsEntry[]
    try {
      const res = await rootApi().workspaceList(rel)
      if (!res.ok) continue
      entries = res.entries
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory) {
        stack.push(entry.relPath)
      } else {
        out.push(entry.relPath)
        if (out.length >= MAX_GLOB_RESULTS) return out
      }
    }
  }
  return out
}

export async function readText(relPath: string): Promise<string> {
  const res = await rootApi().workspaceRead(relPath)
  if (!res.ok) throw new Error(res.error)
  return res.content
}

export async function statExists(relPath: string): Promise<boolean> {
  const res = await rootApi().workspaceStat(relPath)
  if (!res.ok) return false
  return res.stat.exists && !res.stat.isDirectory
}

/** Counts distinct occurrences of `needle` in `haystack`. Split-based
 *  (treats `needle` as a literal string — no regex); matches the semantics
 *  the applier uses when re-verifying patches at apply time. */
export function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0
  return haystack.split(needle).length - 1
}

/** UTF-8 byte length of `str`. Runs in the renderer where Node's
 *  `Buffer` is unavailable — `Blob` is the portable equivalent and is
 *  already used across the codebase for download sizes. */
export function utf8ByteLength(str: string): number {
  return new Blob([str]).size
}
