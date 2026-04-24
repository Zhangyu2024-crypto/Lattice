// Sync IPC surface. All calls funnel into `electron/sync/manager.ts`;
// this file is pure wire-up + response shaping so every channel returns
// the discriminated `{ ok: true, ... } | { ok: false, error }` shape the
// renderer expects.
//
// Paired with the bridges declared in `electron/preload.ts` and the types
// in `src/types/electron.d.ts`.

import { ipcMain } from 'electron'
import * as manager from './sync/manager'
import type { BackendKind, SetupRequest } from './sync/types'

function ensureBackend(v: unknown): BackendKind | null {
  return v === 'webdav' || v === 'rclone' ? v : null
}

function coerceSetup(raw: unknown): SetupRequest | string {
  if (!raw || typeof raw !== 'object') return 'setup payload must be an object'
  const r = raw as Record<string, unknown>
  const backend = ensureBackend(r.backend)
  if (!backend) return 'backend must be "webdav" or "rclone"'
  if (typeof r.remoteUrl !== 'string' || !r.remoteUrl.trim()) {
    return 'remoteUrl is required'
  }
  return {
    backend,
    remoteUrl: r.remoteUrl.trim(),
    username: typeof r.username === 'string' ? r.username : undefined,
    password: typeof r.password === 'string' ? r.password : undefined,
  }
}

let registered = false
let onIntervalChanged: (() => void) | null = null

export function registerSyncIpc(opts?: { onIntervalChanged?: () => void }): void {
  onIntervalChanged = opts?.onIntervalChanged ?? null
  if (registered) return
  registered = true

  ipcMain.handle('sync:setup', async (_e, raw: unknown) => {
    const parsed = coerceSetup(raw)
    if (typeof parsed === 'string') return { ok: false, error: parsed }
    try {
      return await manager.setup(parsed)
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('sync:test-connection', async (_e, raw: unknown) => {
    // Empty / missing payload = test with already-persisted credentials.
    const probe = raw && typeof raw === 'object' && Object.keys(raw).length > 0
      ? coerceSetup(raw)
      : null
    try {
      if (typeof probe === 'string') return { ok: false, error: probe }
      return await manager.testConnection(probe ?? undefined)
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('sync:status', async () => {
    try {
      return await manager.status()
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('sync:push', async (_e, raw: unknown) => {
    const r = (raw && typeof raw === 'object' ? raw : {}) as {
      force?: unknown
      paths?: unknown
    }
    try {
      return await manager.push({
        force: r.force === true,
        paths: Array.isArray(r.paths) ? r.paths.filter((p): p is string => typeof p === 'string') : undefined,
      })
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('sync:pull', async (_e, raw: unknown) => {
    const r = (raw && typeof raw === 'object' ? raw : {}) as {
      force?: unknown
      paths?: unknown
    }
    try {
      return await manager.pull({
        force: r.force === true,
        paths: Array.isArray(r.paths) ? r.paths.filter((p): p is string => typeof p === 'string') : undefined,
      })
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('sync:get-config', async () => {
    try {
      const creds = await manager.loadCredentials()
      const manifest = await manager.readManifest()
      return {
        ok: true,
        configured: Boolean(creds.backend && creds.remote_url),
        backend: creds.backend,
        remoteUrl: creds.remote_url,
        username: creds.username,
        autoPush: manifest.auto_push,
        autoPull: manifest.auto_pull,
        lastSync: manifest.last_sync,
        syncInterval: manifest.sync_interval,
        excludedRoots: manifest.excluded_roots,
        remoteRoot: manifest.remote_root,
      }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('sync:set-auto-push', async (_e, raw: unknown) => {
    const r = raw as { enabled?: unknown }
    try {
      await manager.setAutoPush(r?.enabled === true)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('sync:set-auto-pull', async (_e, raw: unknown) => {
    const r = raw as { enabled?: unknown }
    try {
      await manager.setAutoPull(r?.enabled === true)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('sync:set-interval', async (_e, raw: unknown) => {
    const r = raw as { minutes?: unknown }
    const valid = [0, 5, 15, 30, 60]
    const minutes = typeof r?.minutes === 'number' && valid.includes(r.minutes)
      ? r.minutes as 0 | 5 | 15 | 30 | 60
      : 0
    try {
      await manager.setSyncInterval(minutes)
      if (onIntervalChanged) onIntervalChanged()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('sync:set-excluded-roots', async (_e, raw: unknown) => {
    const r = raw as { roots?: unknown }
    const roots = Array.isArray(r?.roots)
      ? (r.roots as unknown[]).filter((v): v is string => typeof v === 'string')
      : []
    try {
      await manager.setExcludedRoots(roots)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('sync:folder-stats', async () => {
    try {
      const stats = await manager.folderStats()
      return { ok: true, folders: stats }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('sync:set-remote-root', async (_e, raw: unknown) => {
    const r = raw as { folder?: unknown }
    const folder = typeof r?.folder === 'string' ? r.folder : 'Lattice'
    try {
      await manager.setRemoteRoot(folder)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('sync:disable-auto', async () => {
    try {
      await manager.disableAutoSync()
      if (onIntervalChanged) onIntervalChanged()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
}
