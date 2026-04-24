// Manifest read/write + classification helpers.
// Models `${userData}/sync/manifest.json` as described in
// `lattice-cli/docs/cloud_sync.md §4.2`.
//
// The atomic tmp+rename write mirrors `electron/ipc-library.ts::writeLibrary`
// so a crash mid-write never leaves a half-written manifest.

import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import type { FileState, SyncManifest } from './types'

export function manifestPath(): string {
  return path.join(app.getPath('userData'), 'sync', 'manifest.json')
}

export function emptyManifest(): SyncManifest {
  return {
    version: 1,
    backend: '',
    remote_url: '',
    remote_root: 'Lattice',
    last_sync: '',
    auto_push: false,
    auto_pull: false,
    sync_interval: 0,
    excluded_roots: [],
    files: {},
  }
}

export async function readManifest(): Promise<SyncManifest> {
  try {
    const text = await fs.readFile(manifestPath(), 'utf8')
    const data = JSON.parse(text) as Partial<SyncManifest>
    const raw = data as Record<string, unknown>
    const interval = typeof raw.sync_interval === 'number' ? raw.sync_interval : 0
    const validIntervals = [0, 5, 15, 30, 60]
    const rootRaw = typeof raw.remote_root === 'string' ? raw.remote_root.trim() : ''
    return {
      version: 1,
      backend: data.backend === 'webdav' || data.backend === 'rclone' ? data.backend : '',
      remote_url: typeof data.remote_url === 'string' ? data.remote_url : '',
      remote_root: rootRaw || 'Lattice',
      last_sync: typeof data.last_sync === 'string' ? data.last_sync : '',
      auto_push: Boolean(data.auto_push),
      auto_pull: Boolean(data.auto_pull),
      sync_interval: (validIntervals.includes(interval) ? interval : 0) as SyncManifest['sync_interval'],
      excluded_roots: Array.isArray(raw.excluded_roots)
        ? (raw.excluded_roots as unknown[]).filter((r): r is string => typeof r === 'string')
        : [],
      files: normalizeFiles(data.files),
    }
  } catch {
    return emptyManifest()
  }
}

function normalizeFiles(raw: unknown): Record<string, FileState> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, FileState> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const v = value as Record<string, unknown>
    const policy = v.policy
    out[key] = {
      local_hash: typeof v.local_hash === 'string' ? v.local_hash : '',
      remote_hash: typeof v.remote_hash === 'string' ? v.remote_hash : '',
      size: typeof v.size === 'number' ? v.size : 0,
      policy:
        policy === 'required' || policy === 'optional' || policy === 'exclude'
          ? policy
          : 'optional',
      local_mtime: typeof v.local_mtime === 'string' ? v.local_mtime : '',
      remote_mtime: typeof v.remote_mtime === 'string' ? v.remote_mtime : '',
    }
  }
  return out
}

export async function writeManifest(manifest: SyncManifest): Promise<void> {
  const target = manifestPath()
  await fs.mkdir(path.dirname(target), { recursive: true })
  const tmp = `${target}.tmp`
  await fs.writeFile(tmp, JSON.stringify(manifest, null, 2), 'utf8')
  await fs.rename(tmp, target)
}

export type Classification =
  | 'synced'
  | 'to-push'
  | 'to-pull'
  | 'conflict'
  | 'new-local'
  | 'new-remote'

/** Decide how a single file differs between local and remote, given the
 *  last-sync record in the manifest. Follows the CLI truth table in
 *  `cloud_sync.md §4.2`:
 *    local ≠ manifest ∧ remote ≠ manifest → conflict
 *    local ≠ manifest ∧ remote = manifest → push
 *    local = manifest ∧ remote ≠ manifest → pull
 *    …
 *
 *  `remoteSize === null` means the file doesn't exist remotely.
 *  `localHash === null` means the file doesn't exist locally. */
export function classify(
  state: FileState | undefined,
  localHash: string | null,
  localSize: number | null,
  remoteSize: number | null,
): Classification {
  const localMissing = localHash === null || localSize === null
  const remoteMissing = remoteSize === null

  if (localMissing && remoteMissing) return 'synced'
  if (!state) {
    if (!localMissing && remoteMissing) return 'new-local'
    if (localMissing && !remoteMissing) return 'new-remote'
    // Both exist but we've never synced: treat as conflict so the user
    // explicitly picks a side rather than silently overwriting.
    return 'conflict'
  }

  const localChanged = localMissing ? true : state.local_hash !== localHash
  // Remote-side change detection uses size (WebDAV PROPFIND doesn't cheaply
  // expose content hashes). Good enough for our write-patterns: the CLI and
  // CLI-compatible clients all use atomic-rename so remote size changes iff
  // content changed. An edit that preserves byte count would hide here, but
  // that's a pathological case we accept.
  const remoteChanged = remoteMissing ? true : state.size !== remoteSize

  if (!localChanged && !remoteChanged) return 'synced'
  if (localChanged && !remoteChanged) return localMissing ? 'to-pull' : 'to-push'
  if (!localChanged && remoteChanged) return remoteMissing ? 'to-push' : 'to-pull'
  return 'conflict'
}
