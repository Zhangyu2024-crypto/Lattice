// SyncManager — orchestrates setup / status / push / pull.
// Ported from `lattice-cli/src/lattice_cli/sync/manager.py`; behaviour
// (including conflict truth table + `.conflict.<ext>` renaming) matches
// the Python implementation so docs in `cloud_sync.md` stay accurate.
//
// All write-side work funnels through the same `serialized` promise chain
// `ipc-library.ts` uses, so a manual push and the quit-time auto-push can't
// race each other onto manifest.json.

import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import type {
  BackendKind,
  Conflict,
  FileState,
  FolderStats,
  PullReport,
  PushReport,
  RemoteFileInfo,
  SetupRequest,
  StatusReport,
  SyncCredentials,
  SyncManifest,
  SyncIntervalMinutes,
} from './types'
import { MAX_SYNC_FILE_BYTES, SYNC_ROOTS } from './types'
import type { CloudBackend } from './backends/base'
import { WebDAVBackend } from './backends/webdav'
import { RcloneBackend, assertRcloneInstalled } from './backends/rclone'
import { loadCredentials, saveCredentials } from './credentials'
import {
  classify,
  emptyManifest,
  readManifest,
  writeManifest,
} from './manifest'
import { hashFile } from './hasher'
import { scanUserData, type ScannedFile } from './scanner'

/** Single serial queue for every sync-side write. */
let writeTail: Promise<unknown> = Promise.resolve()
async function serialized<T>(task: () => Promise<T>): Promise<T> {
  const prior = writeTail
  let release!: () => void
  writeTail = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    await prior.catch(() => undefined)
    return await task()
  } finally {
    release()
  }
}

function nowIso(): string {
  return new Date().toISOString()
}

function userDataRoot(): string {
  return app.getPath('userData')
}

function backendFromCreds(creds: SyncCredentials): CloudBackend | null {
  if (!creds.backend || !creds.remote_url) return null
  if (creds.backend === 'webdav') {
    return new WebDAVBackend(creds.remote_url, creds.username, creds.password)
  }
  if (creds.backend === 'rclone') {
    return new RcloneBackend(creds.remote_url)
  }
  return null
}

function toConflict(
  relPath: string,
  localSize: number,
  localMtime: string,
  remoteSize: number,
  remoteMtime: string,
): Conflict {
  return {
    path: relPath,
    localSize,
    localMtime,
    remoteSize,
    remoteMtime,
  }
}

function conflictSidecarPath(absPath: string): string {
  const ext = path.extname(absPath)
  const stem = ext ? absPath.slice(0, -ext.length) : absPath
  return `${stem}.conflict${ext}`
}

/** Setup new credentials. Writes manifest (to capture backend + URL) and
 *  credentials (chmod 0600) atomically. Does NOT attempt a connection —
 *  `testConnection` is called separately by the UI. */
export async function setup(req: SetupRequest): Promise<{ ok: true } | { ok: false; error: string }> {
  return serialized(async () => {
    // Basic validation — bail before writing anything to disk.
    if (req.backend === 'webdav') {
      if (!/^https?:\/\//i.test(req.remoteUrl)) {
        return { ok: false, error: 'WebDAV URL must start with http:// or https://' }
      }
    } else if (req.backend === 'rclone') {
      if (!req.remoteUrl.includes(':')) {
        return { ok: false, error: 'rclone remote must look like `<name>:<path>` (e.g. gdrive:lattice)' }
      }
      try {
        await assertRcloneInstalled()
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    } else {
      return { ok: false, error: `unknown backend: ${req.backend}` }
    }

    const creds: SyncCredentials = {
      version: 1,
      backend: req.backend,
      remote_url: req.remoteUrl,
      username: req.username ?? '',
      password: req.password ?? '',
    }
    await saveCredentials(creds)

    const manifest = await readManifest()
    manifest.backend = req.backend
    manifest.remote_url = req.remoteUrl
    if (!manifest.remote_root) manifest.remote_root = 'Lattice'
    // Raw data defaults to OFF — large experimental files should be
    // opted-in per user, not pushed by default.
    if (manifest.excluded_roots.length === 0) {
      manifest.excluded_roots = ['raw']
    }
    // Disable auto-sync on first setup; user turns it on explicitly.
    manifest.auto_push = false
    manifest.auto_pull = false
    manifest.sync_interval = 0
    await writeManifest(manifest)
    return { ok: true }
  })
}

export async function testConnection(
  probe?: SetupRequest,
): Promise<{ ok: true; backend: BackendKind; remoteUrl: string } | { ok: false; error: string }> {
  const creds = probe
    ? {
        version: 1 as const,
        backend: probe.backend,
        remote_url: probe.remoteUrl,
        username: probe.username ?? '',
        password: probe.password ?? '',
      }
    : await loadCredentials()
  const backend = backendFromCreds(creds)
  if (!backend) return { ok: false, error: 'not configured' }
  const result = await backend.testConnection()
  if (result.ok) return { ok: true, backend: creds.backend as BackendKind, remoteUrl: creds.remote_url }
  return { ok: false, error: result.error }
}

/** Prepend the remote root folder (e.g. "Lattice") to a manifest-relative path. */
function withRoot(remoteRoot: string, relPath: string): string {
  const root = remoteRoot.trim().replace(/^\/+|\/+$/g, '')
  return root ? `${root}/${relPath}` : relPath
}

/** Inverse of `withRoot` — strip the remote root prefix so the key matches
 *  the manifest-relative path. Returns `null` for entries outside the root
 *  (those belong to another app / prior install and we don't want to touch
 *  them). */
function stripRoot(remoteRoot: string, remotePath: string): string | null {
  const root = remoteRoot.trim().replace(/^\/+|\/+$/g, '')
  if (!root) return remotePath
  if (remotePath === root) return null
  if (remotePath.startsWith(`${root}/`)) return remotePath.slice(root.length + 1)
  return null
}

async function remoteIndex(
  backend: CloudBackend,
  remoteRoot: string,
): Promise<Map<string, RemoteFileInfo>> {
  const listPrefix = remoteRoot.trim().replace(/^\/+|\/+$/g, '')
  const remote = await backend.listFiles(listPrefix || '')
  const idx = new Map<string, RemoteFileInfo>()
  for (const entry of remote) {
    const rel = stripRoot(remoteRoot, entry.path)
    if (rel === null) continue
    idx.set(rel, { ...entry, path: rel })
  }
  return idx
}

/** Hashes every scanned file — parallelism capped to 4 to avoid thrashing
 *  the disk on large PDF libraries. Results cached by caller. */
async function hashAll(files: ScannedFile[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const q = [...files]
  const workers = Math.min(4, q.length)
  await Promise.all(
    new Array(workers).fill(null).map(async () => {
      while (q.length) {
        const f = q.shift()
        if (!f) break
        if (f.oversize) continue
        try {
          out.set(f.relPath, await hashFile(f.absPath))
        } catch {
          // Unreadable file — skip (it'll surface as an error during push/pull).
        }
      }
    }),
  )
  return out
}

export async function status(): Promise<StatusReport> {
  return serialized(async () => {
    const creds = await loadCredentials()
    const manifest = await readManifest()
    const configured = Boolean(creds.backend && creds.remote_url)
    const report: StatusReport = {
      ok: true,
      configured,
      backend: creds.backend,
      remoteUrl: creds.remote_url,
      lastSync: manifest.last_sync,
      autoPush: manifest.auto_push,
      autoPull: manifest.auto_pull,
      toPush: [],
      toPull: [],
      conflicts: [],
      synced: 0,
    }
    if (!configured) return report
    const backend = backendFromCreds(creds)
    if (!backend) return report
    let remote: Map<string, RemoteFileInfo>
    try {
      remote = await remoteIndex(backend, manifest.remote_root)
    } catch (err) {
      // Surface as a degraded report — caller decides whether to show.
      report.remoteUrl = `${creds.remote_url} (offline: ${(err as Error).message})`
      return report
    }
    const local = await scanUserData({ excludedRoots: manifest.excluded_roots })
    const localHashes = await hashAll(local)
    const seen = new Set<string>()
    for (const f of local) {
      seen.add(f.relPath)
      const state = manifest.files[f.relPath]
      const r = remote.get(f.relPath)
      const c = classify(state, localHashes.get(f.relPath) ?? null, f.size, r?.size ?? null)
      if (c === 'to-push' || c === 'new-local') report.toPush.push(f.relPath)
      else if (c === 'to-pull' || c === 'new-remote') report.toPull.push(f.relPath)
      else if (c === 'conflict') {
        report.conflicts.push(
          toConflict(f.relPath, f.size, f.mtime, r?.size ?? 0, r?.mtime ?? ''),
        )
      } else {
        report.synced += 1
      }
    }
    for (const [relPath, r] of remote) {
      if (seen.has(relPath)) continue
      const state = manifest.files[relPath]
      const c = classify(state, null, null, r.size)
      if (c === 'to-pull' || c === 'new-remote') report.toPull.push(relPath)
      else if (c === 'conflict') {
        report.conflicts.push(toConflict(relPath, 0, '', r.size, r.mtime))
      }
    }
    return report
  })
}

export interface PushPullOptions {
  force?: boolean
  paths?: string[]
}

export async function push(opts: PushPullOptions = {}): Promise<PushReport> {
  return serialized(async () => {
    const report: PushReport = {
      ok: true,
      uploaded: [],
      skipped: [],
      conflicts: [],
      errors: [],
    }
    const creds = await loadCredentials()
    const backend = backendFromCreds(creds)
    if (!backend) {
      report.errors.push({ path: '', msg: 'sync not configured' })
      return report
    }
    const manifest = await readManifest()
    const local = await scanUserData({ excludedRoots: manifest.excluded_roots })
    const localHashes = await hashAll(local)
    let remote: Map<string, RemoteFileInfo>
    try {
      remote = await remoteIndex(backend, manifest.remote_root)
    } catch (err) {
      report.errors.push({ path: '', msg: `remote list failed: ${(err as Error).message}` })
      return report
    }

    const filter = opts.paths ? new Set(opts.paths) : null
    for (const f of local) {
      if (filter && !filter.has(f.relPath)) continue
      if (f.oversize) {
        report.skipped.push({
          path: f.relPath,
          reason: 'too_large',
          detail: `${f.size} bytes > ${MAX_SYNC_FILE_BYTES}`,
        })
        continue
      }
      const localHash = localHashes.get(f.relPath) ?? null
      const r = remote.get(f.relPath)
      const state = manifest.files[f.relPath]
      const c = classify(state, localHash, f.size, r?.size ?? null)
      const shouldUpload =
        c === 'to-push' ||
        c === 'new-local' ||
        (opts.force && (c === 'conflict' || c === 'synced' || c === 'to-pull' || c === 'new-remote'))
      if (!shouldUpload) {
        if (c === 'conflict') {
          report.conflicts.push(
            toConflict(f.relPath, f.size, f.mtime, r?.size ?? 0, r?.mtime ?? ''),
          )
        } else {
          report.skipped.push({ path: f.relPath, reason: 'unchanged' })
        }
        continue
      }
      try {
        await backend.upload(f.absPath, withRoot(manifest.remote_root, f.relPath))
        report.uploaded.push(f.relPath)
        manifest.files[f.relPath] = {
          local_hash: localHash ?? '',
          remote_hash: localHash ?? '',
          size: f.size,
          policy: f.policy,
          local_mtime: f.mtime,
          remote_mtime: nowIso(),
        }
      } catch (err) {
        report.errors.push({ path: f.relPath, msg: (err as Error).message })
      }
    }
    manifest.last_sync = nowIso()
    await writeManifest(manifest)
    return report
  })
}

export async function pull(opts: PushPullOptions = {}): Promise<PullReport> {
  return serialized(async () => {
    const report: PullReport = {
      ok: true,
      downloaded: [],
      renamedAsConflict: [],
      skipped: [],
      errors: [],
    }
    const creds = await loadCredentials()
    const backend = backendFromCreds(creds)
    if (!backend) {
      report.errors.push({ path: '', msg: 'sync not configured' })
      return report
    }
    const manifest = await readManifest()
    const local = await scanUserData({ excludedRoots: manifest.excluded_roots })
    const localHashes = await hashAll(local)
    const localMap = new Map(local.map((f) => [f.relPath, f]))
    let remote: Map<string, RemoteFileInfo>
    try {
      remote = await remoteIndex(backend, manifest.remote_root)
    } catch (err) {
      report.errors.push({ path: '', msg: `remote list failed: ${(err as Error).message}` })
      return report
    }

    const filter = opts.paths ? new Set(opts.paths) : null
    const root = userDataRoot()
    for (const [relPath, r] of remote) {
      if (filter && !filter.has(relPath)) continue
      const localEntry = localMap.get(relPath)
      const localHash = localHashes.get(relPath) ?? null
      const state = manifest.files[relPath]
      const c = classify(state, localHash, localEntry?.size ?? null, r.size)
      const shouldDownload =
        c === 'to-pull' ||
        c === 'new-remote' ||
        (opts.force && (c === 'conflict' || c === 'synced' || c === 'to-push' || c === 'new-local'))
      if (!shouldDownload) {
        if (c === 'conflict') {
          // Non-force pull with a conflict: report it so the UI can surface.
          report.skipped.push({ path: relPath, reason: 'conflict' })
        } else {
          report.skipped.push({ path: relPath, reason: 'unchanged' })
        }
        continue
      }
      const absPath = path.join(root, ...relPath.split('/'))
      // When forcing on a real conflict, preserve the local copy as a
      // sidecar so the user can diff it later.
      if (opts.force && c === 'conflict' && localEntry) {
        const sidecar = conflictSidecarPath(absPath)
        try {
          await fs.copyFile(absPath, sidecar)
          report.renamedAsConflict.push(`${relPath} → ${path.basename(sidecar)}`)
        } catch (err) {
          report.errors.push({ path: relPath, msg: `conflict copy failed: ${(err as Error).message}` })
          continue
        }
      }
      try {
        await backend.download(withRoot(manifest.remote_root, relPath), absPath)
        report.downloaded.push(relPath)
        const hash = await hashFile(absPath).catch(() => '')
        const stat = await fs.stat(absPath).catch(() => null)
        manifest.files[relPath] = {
          local_hash: hash,
          remote_hash: hash,
          size: stat?.size ?? r.size,
          policy: state?.policy ?? 'required',
          local_mtime: stat?.mtime.toISOString() ?? nowIso(),
          remote_mtime: r.mtime || nowIso(),
        }
      } catch (err) {
        report.errors.push({ path: relPath, msg: (err as Error).message })
      }
    }
    manifest.last_sync = nowIso()
    await writeManifest(manifest)
    return report
  })
}

export async function setAutoPush(enabled: boolean): Promise<void> {
  return serialized(async () => {
    const manifest = await readManifest()
    manifest.auto_push = enabled
    await writeManifest(manifest)
  })
}

export async function setAutoPull(enabled: boolean): Promise<void> {
  return serialized(async () => {
    const manifest = await readManifest()
    manifest.auto_pull = enabled
    await writeManifest(manifest)
  })
}

/** Fast path used by `before-quit` — returns true when anything needs to be
 *  pushed. Skips the expensive content hashing. */
export async function hasDirty(): Promise<boolean> {
  const manifest = await readManifest()
  const local = await scanUserData({ excludedRoots: manifest.excluded_roots })
  const localMap = new Map(local.map((f) => [f.relPath, f]))
  for (const [relPath, f] of localMap) {
    const state = manifest.files[relPath]
    if (!state) return true
    if (state.size !== f.size) return true
  }
  for (const relPath of Object.keys(manifest.files)) {
    if (!localMap.has(relPath)) return true // deleted locally — push will surface
  }
  return false
}

export async function setSyncInterval(minutes: SyncIntervalMinutes): Promise<void> {
  return serialized(async () => {
    const manifest = await readManifest()
    manifest.sync_interval = minutes
    await writeManifest(manifest)
  })
}

export async function setExcludedRoots(roots: string[]): Promise<void> {
  return serialized(async () => {
    const manifest = await readManifest()
    manifest.excluded_roots = roots.filter((r) => typeof r === 'string')
    await writeManifest(manifest)
  })
}

export async function setRemoteRoot(folder: string): Promise<void> {
  return serialized(async () => {
    const manifest = await readManifest()
    const cleaned = folder.trim().replace(/^\/+|\/+$/g, '')
    manifest.remote_root = cleaned || 'Lattice'
    await writeManifest(manifest)
  })
}

/** Turn off every automatic sync trigger without wiping credentials. Used
 *  when the user wants to pause sync while the new multi-root design
 *  stabilises — manual Push/Pull still work. */
export async function disableAutoSync(): Promise<void> {
  return serialized(async () => {
    const manifest = await readManifest()
    manifest.auto_push = false
    manifest.auto_pull = false
    manifest.sync_interval = 0
    await writeManifest(manifest)
  })
}

export async function folderStats(): Promise<FolderStats[]> {
  const manifest = await readManifest()
  const creds = await loadCredentials()
  const configured = Boolean(creds.backend && creds.remote_url)
  const allRoots = [...SYNC_ROOTS]
  const local = await scanUserData()

  let remote: Map<string, RemoteFileInfo> | null = null
  if (configured) {
    const backend = backendFromCreds(creds)
    if (backend) {
      try { remote = await remoteIndex(backend, manifest.remote_root) } catch { /* offline */ }
    }
  }

  const localHashes = configured && remote ? await hashAll(local) : new Map<string, string>()
  const stats: FolderStats[] = []
  for (const root of allRoots) {
    const prefix = root + '/'
    const rootFiles = local.filter((f) => f.relPath.startsWith(prefix))
    let toPush = 0
    let toPull = 0
    let conflicts = 0
    if (remote) {
      for (const f of rootFiles) {
        const state = manifest.files[f.relPath]
        const r = remote.get(f.relPath)
        const c = classify(state, localHashes.get(f.relPath) ?? null, f.size, r?.size ?? null)
        if (c === 'to-push' || c === 'new-local') toPush++
        else if (c === 'to-pull' || c === 'new-remote') toPull++
        else if (c === 'conflict') conflicts++
      }
    }
    stats.push({
      root,
      fileCount: rootFiles.length,
      totalBytes: rootFiles.reduce((s, f) => s + f.size, 0),
      toPush,
      toPull,
      conflicts,
    })
  }
  return stats
}

/** Convenience re-exports for the IPC layer. */
export { emptyManifest, readManifest, writeManifest, loadCredentials, saveCredentials }
