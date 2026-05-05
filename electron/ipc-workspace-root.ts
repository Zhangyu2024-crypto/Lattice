import { randomUUID } from 'crypto'
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'fs/promises'
import path from 'path'
import { app, BrowserWindow, clipboard, ipcMain, shell } from 'electron'
import { summarizeTextForAudit, writeAuditEvent } from './audit-writer'
import type { WebContents } from 'electron'
import chokidar from 'chokidar'
import type { FSWatcher } from 'chokidar'
import { isIgnoredWorkspacePath } from './workspace-ignore'

const MAX_READ_BYTES = 8 * 1024 * 1024
const ROOT_CONFIG_FILE = 'workspace-root.json'
const LIST_STAT_CONCURRENCY = 32

type OkEnvelope<T extends object> = { ok: true } & T
type ErrEnvelope = { ok: false; error: string }
type Envelope<T extends object> = OkEnvelope<T> | ErrEnvelope

function auditWorkspaceFs(
  action: string,
  status: 'started' | 'success' | 'error' | 'denied' | 'aborted',
  metadata: Record<string, unknown>,
  error?: unknown,
  durationMs?: number,
): void {
  writeAuditEvent({
    category: 'workspace',
    action,
    status,
    metadata,
    error,
    durationMs,
  })
}

function contentSummary(content: string): ReturnType<typeof summarizeTextForAudit> {
  return summarizeTextForAudit(content)
}

interface FsEntryPayload {
  name: string
  relPath: string
  parentRel: string
  isDirectory: boolean
  size: number
  mtime: number
}

interface FsStatPayload {
  relPath: string
  isDirectory: boolean
  size: number
  mtime: number
  exists: boolean
}

type WatchEventPayload =
  | { type: 'add'; relPath: string; isDirectory: boolean }
  | { type: 'change'; relPath: string }
  | { type: 'unlink'; relPath: string; isDirectory: boolean }
  | { type: 'ready' }

interface WatcherRecord {
  watcher: FSWatcher
  subscribers: Set<WebContents>
  rootAtStart: string
}

let currentRoot: string | null = null
const watchers = new Map<string, WatcherRecord>()
let getMainWindowRef: (() => BrowserWindow | null) | null = null

export function getCurrentWorkspaceRoot(): string | null {
  return currentRoot
}

export async function getCurrentWorkspaceRootLoaded(): Promise<string | null> {
  if (currentRoot == null) currentRoot = await loadRootFromDisk()
  return currentRoot
}

function rootConfigPath(): string {
  return path.join(app.getPath('userData'), ROOT_CONFIG_FILE)
}

async function loadRootFromDisk(): Promise<string | null> {
  try {
    const raw = await readFile(rootConfigPath(), 'utf-8')
    const parsed = JSON.parse(raw) as { rootPath?: unknown }
    if (typeof parsed.rootPath === 'string' && parsed.rootPath.length > 0) {
      try {
        const info = await stat(parsed.rootPath)
        if (info.isDirectory()) return parsed.rootPath
      } catch {
        return null
      }
    }
  } catch {
    // missing or malformed — fall through to null
  }
  return null
}

async function persistRoot(rootPath: string | null): Promise<void> {
  await mkdir(path.dirname(rootConfigPath()), { recursive: true })
  await writeFile(
    rootConfigPath(),
    JSON.stringify({ rootPath }, null, 2),
    'utf-8',
  )
}

function toPosix(rel: string): string {
  return rel.split(path.sep).join('/')
}

function normalizeRel(rel: unknown): string {
  if (typeof rel !== 'string') throw new Error('relPath must be a string')
  if (rel.includes('\0')) throw new Error('null byte in path')
  const trimmed = rel.replace(/^[/\\]+|[/\\]+$/g, '')
  return trimmed
}

function resolveInRoot(rel: string): { abs: string; rel: string } {
  if (currentRoot == null) throw new Error('workspace root not set')
  const clean = normalizeRel(rel)
  if (path.isAbsolute(clean)) throw new Error('absolute paths are not allowed')
  if (/^[A-Za-z]:/.test(clean)) throw new Error('windows drive letter rejected')
  const rootAbs = path.resolve(currentRoot)
  const resolved = path.resolve(rootAbs, clean)
  if (resolved !== rootAbs && !resolved.startsWith(rootAbs + path.sep)) {
    throw new Error('path traversal blocked')
  }
  return { abs: resolved, rel: clean }
}

function toEntry(
  rootAbs: string,
  parentAbs: string,
  parentRel: string,
  name: string,
  info: { isDirectory: boolean; size: number; mtimeMs: number },
): FsEntryPayload {
  const childAbs = path.join(parentAbs, name)
  const rel = toPosix(path.relative(rootAbs, childAbs))
  return {
    name,
    relPath: rel,
    parentRel: toPosix(parentRel),
    isDirectory: info.isDirectory,
    size: info.size,
    mtime: info.mtimeMs,
  }
}

async function listDir(rel: string): Promise<FsEntryPayload[]> {
  if (currentRoot == null) throw new Error('workspace root not set')
  const { abs, rel: relClean } = resolveInRoot(rel)
  const info = await stat(abs)
  if (!info.isDirectory()) throw new Error('not a directory')
  const entries = await readdir(abs, { withFileTypes: true })
  const out: FsEntryPayload[] = []
  const rootAbs = path.resolve(currentRoot)
  const parentRel = toPosix(relClean)
  const visibleEntries = entries.filter((entry) => {
    const childRel = parentRel ? `${parentRel}/${entry.name}` : entry.name
    return !isIgnoredWorkspacePath(childRel)
  })

  let nextIndex = 0
  async function statNextEntry(): Promise<void> {
    for (;;) {
      const idx = nextIndex
      nextIndex += 1
      const entry = visibleEntries[idx]
      if (!entry) return
      const name = entry.name
      try {
        const childAbs = path.join(abs, name)
        const childStat = await stat(childAbs)
        out.push(
          toEntry(rootAbs, abs, parentRel, name, {
            isDirectory: childStat.isDirectory(),
            size: childStat.isDirectory() ? 0 : childStat.size,
            mtimeMs: childStat.mtimeMs,
          }),
        )
      } catch {
        // skip unreadable entries silently
      }
    }
  }

  const workerCount = Math.min(LIST_STAT_CONCURRENCY, visibleEntries.length)
  await Promise.all(
    Array.from({ length: workerCount }, () => statNextEntry()),
  )

  out.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return out
}

function broadcastWatchEvent(
  watchId: string,
  event: WatchEventPayload,
): void {
  const rec = watchers.get(watchId)
  if (!rec) return
  for (const wc of rec.subscribers) {
    if (!wc.isDestroyed()) {
      wc.send('workspace:watch:event', { watchId, event })
    }
  }
}

function chokidarTypeFor(
  absPath: string,
  rootAbs: string,
): { rel: string } | null {
  const rel = toPosix(path.relative(rootAbs, absPath))
  if (rel === '' || rel.startsWith('..')) return null
  return { rel }
}

async function startWatcher(relDir: string): Promise<string> {
  if (currentRoot == null) throw new Error('workspace root not set')
  const { abs, rel } = resolveInRoot(relDir)
  const rootAbs = path.resolve(currentRoot)
  const watchId = randomUUID()
  const shouldIgnoreWatchPath = (candidatePath: string): boolean => {
    const absCandidate = path.isAbsolute(candidatePath)
      ? candidatePath
      : path.resolve(rootAbs, candidatePath)
    const info = chokidarTypeFor(absCandidate, rootAbs)
    return info ? isIgnoredWorkspacePath(info.rel) : false
  }
  const watcher = chokidar.watch(abs, {
    ignoreInitial: true,
    ignored: shouldIgnoreWatchPath,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  })
  watchers.set(watchId, {
    watcher,
    subscribers: new Set(),
    rootAtStart: rootAbs,
  })
  watcher.on('add', (p) => {
    const info = chokidarTypeFor(p, rootAbs)
    if (!info) return
    broadcastWatchEvent(watchId, {
      type: 'add',
      relPath: info.rel,
      isDirectory: false,
    })
  })
  watcher.on('addDir', (p) => {
    const info = chokidarTypeFor(p, rootAbs)
    if (!info) return
    broadcastWatchEvent(watchId, {
      type: 'add',
      relPath: info.rel,
      isDirectory: true,
    })
  })
  watcher.on('change', (p) => {
    const info = chokidarTypeFor(p, rootAbs)
    if (!info) return
    broadcastWatchEvent(watchId, { type: 'change', relPath: info.rel })
  })
  watcher.on('unlink', (p) => {
    const info = chokidarTypeFor(p, rootAbs)
    if (!info) return
    broadcastWatchEvent(watchId, {
      type: 'unlink',
      relPath: info.rel,
      isDirectory: false,
    })
  })
  watcher.on('unlinkDir', (p) => {
    const info = chokidarTypeFor(p, rootAbs)
    if (!info) return
    broadcastWatchEvent(watchId, {
      type: 'unlink',
      relPath: info.rel,
      isDirectory: true,
    })
  })
  watcher.on('ready', () => {
    broadcastWatchEvent(watchId, { type: 'ready' })
  })
  // Suppress unused-var lint on captured `rel` — keep for future debug prints.
  void rel
  return watchId
}

async function stopWatcher(watchId: string): Promise<void> {
  const rec = watchers.get(watchId)
  if (!rec) return
  watchers.delete(watchId)
  try {
    await rec.watcher.close()
  } catch {
    // already closed
  }
}

async function stopAllWatchers(): Promise<void> {
  const ids = Array.from(watchers.keys())
  await Promise.allSettled(ids.map((id) => stopWatcher(id)))
}

export async function closeAllWorkspaceWatchers(): Promise<void> {
  await stopAllWatchers()
}

function senderWebContents(event: Electron.IpcMainInvokeEvent): WebContents {
  return event.sender
}

function trashTarget(rel: string): string {
  const today = new Date().toISOString().slice(0, 10)
  const base = path.posix.basename(rel) || 'item'
  const uuid = randomUUID()
  return `.lattice/trash/${today}/${uuid}-${base}`
}

async function softDelete(rel: string): Promise<void> {
  if (currentRoot == null) throw new Error('workspace root not set')
  const srcInfo = resolveInRoot(rel)
  const target = trashTarget(srcInfo.rel)
  const dstInfo = resolveInRoot(target)
  await mkdir(path.dirname(dstInfo.abs), { recursive: true })
  await rename(srcInfo.abs, dstInfo.abs)
}

export function registerWorkspaceRootIpc(
  getMainWindow: () => BrowserWindow | null,
): void {
  getMainWindowRef = getMainWindow

  void loadRootFromDisk().then((loaded) => {
    if (currentRoot == null) currentRoot = loaded
  })

  ipcMain.handle(
    'workspace-root:get',
    async (): Promise<Envelope<{ rootPath: string | null }>> => {
      if (currentRoot == null) {
        const loaded = await loadRootFromDisk()
        currentRoot = loaded
      }
      return { ok: true, rootPath: currentRoot }
    },
  )

  ipcMain.handle(
    'workspace-root:set',
    async (_event, payload: unknown): Promise<Envelope<{ rootPath: string }>> => {
      const startedAt = Date.now()
      try {
        const req = payload as { rootPath?: unknown }
        if (typeof req?.rootPath !== 'string' || req.rootPath.length === 0) {
          auditWorkspaceFs('root_set', 'error', {}, 'rootPath required', Date.now() - startedAt)
          return { ok: false, error: 'rootPath required' }
        }
        const rootPath = path.resolve(req.rootPath)
        auditWorkspaceFs('root_set', 'started', { rootPath })
        await mkdir(rootPath, { recursive: true })
        await stopAllWatchers()
        currentRoot = rootPath
        await persistRoot(rootPath)
        auditWorkspaceFs('root_set', 'success', { rootPath }, undefined, Date.now() - startedAt)
        return { ok: true, rootPath }
      } catch (err) {
        auditWorkspaceFs('root_set', 'error', {}, err, Date.now() - startedAt)
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(
    'workspace:list',
    async (_event, payload: unknown): Promise<Envelope<{ entries: FsEntryPayload[] }>> => {
      const startedAt = Date.now()
      const req = payload as { rel?: unknown }
      const rel = typeof req?.rel === 'string' ? req.rel : ''
      try {
        const entries = await listDir(rel)
        auditWorkspaceFs(
          'list',
          'success',
          { relPath: rel, entryCount: entries.length },
          undefined,
          Date.now() - startedAt,
        )
        return { ok: true, entries }
      } catch (err) {
        auditWorkspaceFs('list', 'error', { relPath: rel }, err, Date.now() - startedAt)
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(
    'workspace:stat',
    async (_event, payload: unknown): Promise<Envelope<{ stat: FsStatPayload }>> => {
      const startedAt = Date.now()
      const req = payload as { rel?: unknown }
      const rel = typeof req?.rel === 'string' ? req.rel : ''
      try {
        const { abs, rel: clean } = resolveInRoot(rel)
        try {
          const info = await stat(abs)
          auditWorkspaceFs(
            'stat',
            'success',
            {
              relPath: clean,
              exists: true,
              isDirectory: info.isDirectory(),
              size: info.isDirectory() ? 0 : info.size,
            },
            undefined,
            Date.now() - startedAt,
          )
          return {
            ok: true,
            stat: {
              relPath: clean,
              isDirectory: info.isDirectory(),
              size: info.isDirectory() ? 0 : info.size,
              mtime: info.mtimeMs,
              exists: true,
            },
          }
        } catch {
          auditWorkspaceFs(
            'stat',
            'success',
            { relPath: clean, exists: false },
            undefined,
            Date.now() - startedAt,
          )
          return {
            ok: true,
            stat: {
              relPath: clean,
              isDirectory: false,
              size: 0,
              mtime: 0,
              exists: false,
            },
          }
        }
      } catch (err) {
        auditWorkspaceFs('stat', 'error', { relPath: rel }, err, Date.now() - startedAt)
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(
    'workspace:read',
    async (_event, payload: unknown): Promise<Envelope<{ content: string }>> => {
      const startedAt = Date.now()
      const req = payload as { rel?: unknown }
      const rel = typeof req?.rel === 'string' ? req.rel : ''
      try {
        if (typeof req?.rel !== 'string') return { ok: false, error: 'rel required' }
        const { abs } = resolveInRoot(req.rel)
        const info = await stat(abs)
        if (info.size > MAX_READ_BYTES) {
          auditWorkspaceFs(
            'read',
            'error',
            { relPath: req.rel, size: info.size },
            `file too large (${info.size} bytes)`,
            Date.now() - startedAt,
          )
          return { ok: false, error: `file too large (${info.size} bytes)` }
        }
        const content = await readFile(abs, 'utf-8')
        auditWorkspaceFs(
          'read',
          'success',
          {
            relPath: req.rel,
            size: info.size,
            content: contentSummary(content),
          },
          undefined,
          Date.now() - startedAt,
        )
        return { ok: true, content }
      } catch (err) {
        auditWorkspaceFs('read', 'error', { relPath: rel }, err, Date.now() - startedAt)
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(
    'workspace:readBinary',
    async (_event, payload: unknown): Promise<Envelope<{ data: ArrayBuffer }>> => {
      const startedAt = Date.now()
      const req = payload as { rel?: unknown }
      const rel = typeof req?.rel === 'string' ? req.rel : ''
      try {
        if (typeof req?.rel !== 'string') return { ok: false, error: 'rel required' }
        const { abs } = resolveInRoot(req.rel)
        const info = await stat(abs)
        if (info.size > 64 * 1024 * 1024) {
          auditWorkspaceFs(
            'read_binary',
            'error',
            { relPath: req.rel, size: info.size },
            `file too large (${info.size} bytes)`,
            Date.now() - startedAt,
          )
          return { ok: false, error: `file too large (${info.size} bytes)` }
        }
        const buf = await readFile(abs)
        const ab = new ArrayBuffer(buf.byteLength)
        new Uint8Array(ab).set(buf)
        auditWorkspaceFs(
          'read_binary',
          'success',
          { relPath: req.rel, size: buf.byteLength },
          undefined,
          Date.now() - startedAt,
        )
        return { ok: true, data: ab }
      } catch (err) {
        auditWorkspaceFs('read_binary', 'error', { relPath: rel }, err, Date.now() - startedAt)
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(
    'workspace:write',
    async (_event, payload: unknown): Promise<Envelope<{ bytes: number }>> => {
      const startedAt = Date.now()
      const req = payload as { rel?: unknown; content?: unknown }
      const rel = typeof req?.rel === 'string' ? req.rel : ''
      try {
        if (typeof req?.rel !== 'string' || typeof req?.content !== 'string') {
          auditWorkspaceFs('write', 'error', { relPath: rel }, 'rel and content required', Date.now() - startedAt)
          return { ok: false, error: 'rel and content required' }
        }
        const { abs } = resolveInRoot(req.rel)
        await mkdir(path.dirname(abs), { recursive: true })
        const tmp = `${abs}.tmp-${randomUUID()}`
        await writeFile(tmp, req.content, 'utf-8')
        await rename(tmp, abs)
        const bytes = Buffer.byteLength(req.content, 'utf-8')
        auditWorkspaceFs(
          'write',
          'success',
          {
            relPath: req.rel,
            bytes,
            content: contentSummary(req.content),
          },
          undefined,
          Date.now() - startedAt,
        )
        return { ok: true, bytes }
      } catch (err) {
        auditWorkspaceFs('write', 'error', { relPath: rel }, err, Date.now() - startedAt)
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(
    'workspace:writeBinary',
    async (_event, payload: unknown): Promise<Envelope<{ bytes: number }>> => {
      const startedAt = Date.now()
      const req = payload as { rel?: unknown; data?: unknown }
      const rel = typeof req?.rel === 'string' ? req.rel : ''
      try {
        if (typeof req?.rel !== 'string') {
          auditWorkspaceFs('write_binary', 'error', { relPath: rel }, 'rel required', Date.now() - startedAt)
          return { ok: false, error: 'rel required' }
        }
        // Accepts ArrayBuffer (structured-clone path) or Uint8Array —
        // preload chooses the wire shape. Reject anything else so a
        // stray text payload never lands as corrupted binary on disk.
        let buf: Buffer
        if (req.data instanceof ArrayBuffer) {
          buf = Buffer.from(new Uint8Array(req.data))
        } else if (ArrayBuffer.isView(req.data)) {
          const view = req.data as ArrayBufferView
          buf = Buffer.from(
            view.buffer,
            view.byteOffset,
            view.byteLength,
          )
        } else {
          auditWorkspaceFs(
            'write_binary',
            'error',
            { relPath: req.rel },
            'data must be ArrayBuffer or typed array',
            Date.now() - startedAt,
          )
          return {
            ok: false,
            error: 'data must be ArrayBuffer or typed array',
          }
        }
        const { abs } = resolveInRoot(req.rel)
        await mkdir(path.dirname(abs), { recursive: true })
        const tmp = `${abs}.tmp-${randomUUID()}`
        await writeFile(tmp, buf)
        await rename(tmp, abs)
        auditWorkspaceFs(
          'write_binary',
          'success',
          { relPath: req.rel, bytes: buf.byteLength },
          undefined,
          Date.now() - startedAt,
        )
        return { ok: true, bytes: buf.byteLength }
      } catch (err) {
        auditWorkspaceFs('write_binary', 'error', { relPath: rel }, err, Date.now() - startedAt)
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(
    'workspace:append',
    async (_event, payload: unknown): Promise<Envelope<object>> => {
      const startedAt = Date.now()
      const req = payload as { rel?: unknown; content?: unknown }
      const rel = typeof req?.rel === 'string' ? req.rel : ''
      try {
        if (typeof req?.rel !== 'string' || typeof req?.content !== 'string') {
          auditWorkspaceFs('append', 'error', { relPath: rel }, 'rel and content required', Date.now() - startedAt)
          return { ok: false, error: 'rel and content required' }
        }
        const { abs } = resolveInRoot(req.rel)
        await mkdir(path.dirname(abs), { recursive: true })
        await appendFile(abs, req.content, 'utf-8')
        auditWorkspaceFs(
          'append',
          'success',
          {
            relPath: req.rel,
            bytes: Buffer.byteLength(req.content, 'utf-8'),
            content: contentSummary(req.content),
          },
          undefined,
          Date.now() - startedAt,
        )
        return { ok: true }
      } catch (err) {
        auditWorkspaceFs('append', 'error', { relPath: rel }, err, Date.now() - startedAt)
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(
    'workspace:mkdir',
    async (_event, payload: unknown): Promise<Envelope<object>> => {
      const startedAt = Date.now()
      const req = payload as { rel?: unknown }
      const rel = typeof req?.rel === 'string' ? req.rel : ''
      try {
        if (typeof req?.rel !== 'string') {
          auditWorkspaceFs('mkdir', 'error', { relPath: rel }, 'rel required', Date.now() - startedAt)
          return { ok: false, error: 'rel required' }
        }
        const { abs } = resolveInRoot(req.rel)
        await mkdir(abs, { recursive: true })
        auditWorkspaceFs('mkdir', 'success', { relPath: req.rel }, undefined, Date.now() - startedAt)
        return { ok: true }
      } catch (err) {
        auditWorkspaceFs('mkdir', 'error', { relPath: rel }, err, Date.now() - startedAt)
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(
    'workspace:move',
    async (_event, payload: unknown): Promise<Envelope<object>> => {
      const startedAt = Date.now()
      const req = payload as { from?: unknown; to?: unknown }
      const from = typeof req?.from === 'string' ? req.from : ''
      const to = typeof req?.to === 'string' ? req.to : ''
      try {
        if (typeof req?.from !== 'string' || typeof req?.to !== 'string') {
          auditWorkspaceFs('move', 'error', { from, to }, 'from and to required', Date.now() - startedAt)
          return { ok: false, error: 'from and to required' }
        }
        const src = resolveInRoot(req.from)
        const dst = resolveInRoot(req.to)
        await mkdir(path.dirname(dst.abs), { recursive: true })
        await rename(src.abs, dst.abs)
        auditWorkspaceFs('move', 'success', { from: req.from, to: req.to }, undefined, Date.now() - startedAt)
        return { ok: true }
      } catch (err) {
        auditWorkspaceFs('move', 'error', { from, to }, err, Date.now() - startedAt)
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(
    'workspace:delete',
    async (_event, payload: unknown): Promise<Envelope<object>> => {
      const startedAt = Date.now()
      const req = payload as { rel?: unknown; toTrash?: unknown }
      const rel = typeof req?.rel === 'string' ? req.rel : ''
      const toTrash = req.toTrash !== false
      try {
        if (typeof req?.rel !== 'string') {
          auditWorkspaceFs('delete', 'error', { relPath: rel, toTrash }, 'rel required', Date.now() - startedAt)
          return { ok: false, error: 'rel required' }
        }
        if (toTrash) {
          await softDelete(req.rel)
        } else {
          const { abs } = resolveInRoot(req.rel)
          await rm(abs, { recursive: true, force: true })
        }
        auditWorkspaceFs('delete', 'success', { relPath: req.rel, toTrash }, undefined, Date.now() - startedAt)
        return { ok: true }
      } catch (err) {
        auditWorkspaceFs('delete', 'error', { relPath: rel, toTrash }, err, Date.now() - startedAt)
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  // ─── System integration (reveal / open / copy path) ──────────

  ipcMain.handle(
    'workspace:reveal-in-folder',
    async (_event, payload: unknown): Promise<Envelope<object>> => {
      try {
        const rel = typeof payload === 'string' ? payload : (payload as { rel?: unknown })?.rel
        if (typeof rel !== 'string') return { ok: false, error: 'rel required' }
        const { abs } = resolveInRoot(rel)
        shell.showItemInFolder(abs)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(
    'workspace:open-in-system',
    async (_event, payload: unknown): Promise<Envelope<object>> => {
      try {
        const rel = typeof payload === 'string' ? payload : (payload as { rel?: unknown })?.rel
        if (typeof rel !== 'string') return { ok: false, error: 'rel required' }
        const { abs } = resolveInRoot(rel)
        const result = await shell.openPath(abs)
        if (result) return { ok: false, error: result }
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(
    'workspace:copy-path',
    async (_event, payload: unknown): Promise<Envelope<object>> => {
      try {
        const rel = typeof payload === 'string' ? payload : (payload as { rel?: unknown })?.rel
        if (typeof rel !== 'string') return { ok: false, error: 'rel required' }
        const { abs } = resolveInRoot(rel)
        clipboard.writeText(abs)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(
    'workspace:watch:start',
    async (event, payload: unknown): Promise<Envelope<{ watchId: string }>> => {
      try {
        const req = payload as { rel?: unknown }
        const rel = typeof req?.rel === 'string' ? req.rel : ''
        const watchId = await startWatcher(rel)
        const rec = watchers.get(watchId)
        if (rec) {
          const wc = senderWebContents(event)
          rec.subscribers.add(wc)
          wc.once('destroyed', () => {
            rec.subscribers.delete(wc)
            if (rec.subscribers.size === 0) {
              void stopWatcher(watchId)
            }
          })
        }
        return { ok: true, watchId }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(
    'workspace:watch:stop',
    async (_event, payload: unknown): Promise<Envelope<object>> => {
      try {
        const req = payload as { watchId?: unknown }
        if (typeof req?.watchId !== 'string') {
          return { ok: false, error: 'watchId required' }
        }
        await stopWatcher(req.watchId)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  // Keep the main-window ref referenced to avoid unused-var lint; reserved
  // for future focus flows that need the parent window.
  void getMainWindowRef
}
