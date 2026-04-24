// Local filesystem scanner. Walks the subset of `${userData}` that is
// eligible for sync (library + research today; easy to add new roots later)
// and returns relative paths with their size + policy classification.
//
// This is intentionally separate from `manager.ts` so tests / dev tools can
// inspect the scan output without triggering network I/O.

import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import type { SyncPolicy } from './types'
import {
  EXCLUDE_SUBSTRINGS,
  HARDCODED_EXCLUDES,
  MAX_SYNC_FILE_BYTES,
  SYNC_ROOTS,
} from './types'

export interface ScannedFile {
  /** Path relative to `${userData}`, slash-joined. Stable manifest key. */
  relPath: string
  absPath: string
  size: number
  mtime: string
  policy: SyncPolicy
  /** When true, the file is over `MAX_SYNC_FILE_BYTES` and should be
   *  skipped on push; the report will surface it so the user knows. */
  oversize: boolean
}

export interface ScanOptions {
  /** Per-glob overrides — unused in V1 (fixed defaults below) but wired in
   *  so the Settings UI can expose toggles later. */
  policyOverrides?: Record<string, SyncPolicy>
  /** Root names to skip entirely (e.g. `['research']`). */
  excludedRoots?: string[]
}

function userDataRoot(): string {
  return app.getPath('userData')
}

function toRel(root: string, abs: string): string {
  const rel = path.relative(root, abs)
  // Force forward-slash so manifest keys are the same across Windows/macOS/Linux.
  return rel.split(path.sep).join('/')
}

/** Default policy table. V1 sends everything marked `required`; PDFs are
 *  upgraded to `required` because the user confirmed they want them synced.
 *  New entries here flow into the manifest automatically on the next push. */
function defaultPolicy(relPath: string): SyncPolicy {
  if (HARDCODED_EXCLUDES.includes(relPath as (typeof HARDCODED_EXCLUDES)[number])) {
    return 'exclude'
  }
  for (const sub of EXCLUDE_SUBSTRINGS) {
    if (relPath.includes(sub)) return 'exclude'
  }
  if (relPath === 'library/library.json') return 'required'
  if (relPath.startsWith('library/pdfs/')) return 'required'
  if (relPath.startsWith('research/')) return 'required'
  if (relPath.startsWith('artifacts/')) return 'required'
  if (relPath.startsWith('compute-scripts/')) return 'required'
  if (relPath.startsWith('raw/')) return 'required'
  return 'optional'
}

async function walk(root: string, rel: string, out: string[]): Promise<void> {
  const abs = rel ? path.join(root, rel) : root
  let entries: import('fs').Dirent[]
  try {
    entries = await fs.readdir(abs, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const childRel = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      await walk(root, childRel, out)
    } else if (entry.isFile()) {
      out.push(childRel)
    }
  }
}

/** Yield every syncable file under the configured roots. Excluded files
 *  are filtered out, policy is attached, oversized files are flagged. */
export async function scanUserData(opts: ScanOptions = {}): Promise<ScannedFile[]> {
  const root = userDataRoot()
  // Scan roots = library/, research/, plus the manifest/credentials for
  // exclusion bookkeeping. Keep list small; additions require explicit
  // review because each root widens the sync surface.
  const allRoots = [...SYNC_ROOTS]
  const roots = opts.excludedRoots?.length
    ? allRoots.filter((r) => !opts.excludedRoots!.includes(r))
    : allRoots
  const rels: string[] = []
  for (const r of roots) {
    await walk(root, r, rels)
  }
  const out: ScannedFile[] = []
  for (const relPath of rels) {
    const override = opts.policyOverrides?.[relPath]
    const policy = override ?? defaultPolicy(relPath)
    if (policy === 'exclude') continue
    const absPath = path.join(root, ...relPath.split('/'))
    let stat: import('fs').Stats
    try {
      stat = await fs.stat(absPath)
    } catch {
      continue
    }
    out.push({
      relPath,
      absPath,
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      policy,
      oversize: stat.size > MAX_SYNC_FILE_BYTES,
    })
  }
  return out
}
