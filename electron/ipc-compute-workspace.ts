// Compute-scoped workspace listing IPC.
//
// The global workspace root (ipc-workspace-root.ts) is per-app — changing
// it reroutes the Explorer. The Compute overlay needs a different root
// that doesn't affect the rest of the app. Rather than threading a
// `rootOverride` through every existing workspace API (list / read / etc.),
// this file exposes ONE narrow channel — read-only, listing-only —
// sufficient for the Assets rail.
//
// `compute:list-dir-at` takes an absolute directory and returns a
// bounded recursive listing (capped at MAX_DEPTH + MAX_ENTRIES) that the
// rail can render as a tree. Files are not readable through this
// channel; structure building inside Compute cells uses session
// artifacts + `load_structure()`, not workspace reads, so read access
// isn't needed yet.

import path from 'path'
import { readdir, readFile, stat } from 'fs/promises'
import { ipcMain, shell, clipboard } from 'electron'

interface ComputeFsEntry {
  name: string
  /** Path relative to the caller-supplied `absPath` root, POSIX separators. */
  relPath: string
  parentRel: string
  isDirectory: boolean
  size: number
  mtime: number
}

type Result<T extends object> = ({ ok: true } & T) | { ok: false; error: string }

// Safety caps. The rail is a compact list; these keep a runaway scan
// (huge monorepo, symlink cycle) from blocking the renderer.
const MAX_DEPTH = 4
const MAX_ENTRIES = 500

function toPosix(p: string): string {
  return p.split(path.sep).join('/')
}

/**
 * Recursive DFS with caps. Skips hidden entries (`.`-prefixed) and the
 * `.lattice` metadata dir so the rail doesn't get noise. Stops early
 * when either cap is hit.
 */
async function listRecursive(
  rootAbs: string,
  out: ComputeFsEntry[],
  parentAbs: string,
  parentRel: string,
  depth: number,
): Promise<void> {
  if (depth > MAX_DEPTH) return
  if (out.length >= MAX_ENTRIES) return
  let entries
  try {
    entries = await readdir(parentAbs, { withFileTypes: true })
  } catch {
    return
  }
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  for (const entry of entries) {
    if (out.length >= MAX_ENTRIES) return
    const name = entry.name
    if (name === '.lattice' || name.startsWith('.')) continue
    const childAbs = path.join(parentAbs, name)
    let info
    try {
      info = await stat(childAbs)
    } catch {
      continue
    }
    const rel = toPosix(path.relative(rootAbs, childAbs))
    out.push({
      name,
      relPath: rel,
      parentRel,
      isDirectory: info.isDirectory(),
      size: info.isDirectory() ? 0 : info.size,
      mtime: info.mtimeMs,
    })
    if (info.isDirectory()) {
      await listRecursive(rootAbs, out, childAbs, rel, depth + 1)
    }
  }
}

// Per-file read cap. Prevents "Load into cell" from hanging the renderer
// on a multi-GB file the user pointed the picker at by mistake. 8 MB is
// generous for CIFs (typical <50 KB) and Python scripts while still
// fitting comfortably in a renderer string.
const MAX_READ_BYTES = 8 * 1024 * 1024

export function registerComputeWorkspaceIpc(): void {
  ipcMain.handle(
    'compute:list-dir-at',
    async (
      _e,
      req: { absPath?: unknown },
    ): Promise<Result<{ entries: ComputeFsEntry[]; rootPath: string }>> => {
      const absPath = typeof req?.absPath === 'string' ? req.absPath : ''
      if (!absPath || !path.isAbsolute(absPath)) {
        return { ok: false, error: 'absPath must be an absolute directory path' }
      }
      try {
        const info = await stat(absPath)
        if (!info.isDirectory()) {
          return { ok: false, error: `${absPath} is not a directory` }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { ok: false, error: `Cannot read ${absPath}: ${msg}` }
      }
      const out: ComputeFsEntry[] = []
      const rootAbs = path.resolve(absPath)
      await listRecursive(rootAbs, out, rootAbs, '', 0)
      return { ok: true, entries: out, rootPath: rootAbs }
    },
  )

  // Read a file within a caller-supplied root. Both the root and the
  // relative path come from the renderer; we re-join and re-check
  // containment so a crafted `..` traversal can't escape the chosen
  // compute folder.
  ipcMain.handle(
    'compute:read-file-at',
    async (
      _e,
      req: { rootPath?: unknown; relPath?: unknown },
    ): Promise<Result<{ content: string; size: number }>> => {
      const root = typeof req?.rootPath === 'string' ? req.rootPath : ''
      const rel = typeof req?.relPath === 'string' ? req.relPath : ''
      if (!root || !path.isAbsolute(root)) {
        return { ok: false, error: 'rootPath must be absolute' }
      }
      if (!rel) {
        return { ok: false, error: 'relPath required' }
      }
      const rootAbs = path.resolve(root)
      const target = path.resolve(rootAbs, rel)
      // Containment check — target must live under root.
      const relCheck = path.relative(rootAbs, target)
      if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
        return { ok: false, error: 'Path escapes compute folder' }
      }
      try {
        const info = await stat(target)
        if (info.isDirectory()) {
          return { ok: false, error: 'Target is a directory' }
        }
        if (info.size > MAX_READ_BYTES) {
          return {
            ok: false,
            error: `File too large (${(info.size / 1_048_576).toFixed(1)} MB) — cap is ${MAX_READ_BYTES / 1_048_576} MB`,
          }
        }
        const buf = await readFile(target)
        return { ok: true, content: buf.toString('utf8'), size: info.size }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { ok: false, error: msg }
      }
    },
  )

  // Reveal / copy path helpers tied to the compute folder. Mirrors the
  // workspace equivalents (workspaceRevealInFolder / workspaceCopyPath)
  // but takes an absolute path instead of a workspace-rel one.
  ipcMain.handle(
    'compute:reveal-at',
    async (_e, req: { absPath?: unknown }): Promise<{ ok: boolean; error?: string }> => {
      const abs = typeof req?.absPath === 'string' ? req.absPath : ''
      if (!abs || !path.isAbsolute(abs)) {
        return { ok: false, error: 'absPath must be absolute' }
      }
      try {
        shell.showItemInFolder(abs)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(
    'compute:copy-path-at',
    async (_e, req: { absPath?: unknown }): Promise<{ ok: boolean; error?: string }> => {
      const abs = typeof req?.absPath === 'string' ? req.absPath : ''
      if (!abs) {
        return { ok: false, error: 'absPath required' }
      }
      try {
        clipboard.writeText(abs)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )
}
