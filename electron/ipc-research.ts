// IPC: persist research-report artifacts to `${userData}/research/`.
//
// Motivation: research reports currently live only in Zustand + localStorage
// (see `src/stores/runtime-store.ts`). For cloud-sync to touch them, they
// need a disk footprint. This handler mirrors each artifact as a stable
// per-file JSON at `${userData}/research/<sessionId>/<artifactId>.json`,
// matching the layout the sync scanner expects.
//
// Renderer-side pairing: `src/lib/research-mirror.ts` subscribes to the
// runtime-store and calls `researchPersist` / `researchDelete`; boot-time
// hydration happens via `researchList`.

import { app, ipcMain } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'

interface PersistRequest {
  sessionId: string
  artifactId: string
  payload: unknown
  kind: string
  updatedAt: number
}

interface StoredFile extends PersistRequest {
  version: 1
}

function researchRoot(): string {
  return path.join(app.getPath('userData'), 'research')
}

function isSafeId(id: string): boolean {
  // Accept only our id alphabet (letters, digits, `_`, `-`). Prevents path
  // traversal via `../`, absolute paths, or separators leaking through.
  return /^[A-Za-z0-9_-]{1,64}$/.test(id)
}

function filePath(sessionId: string, artifactId: string): string {
  return path.join(researchRoot(), sessionId, `${artifactId}.json`)
}

async function writeAtomic(target: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true })
  const tmp = `${target}.tmp`
  await fs.writeFile(tmp, content, 'utf8')
  await fs.rename(tmp, target)
}

// Same serial queue pattern used by `ipc-library.ts` — research writes
// come in bursts (debounced 1.5 s client-side, but still overlapping when
// the user edits multiple sessions).
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

let registered = false

export function registerResearchIpc(): void {
  if (registered) return
  registered = true

  ipcMain.handle('research:persist', async (_e, raw: unknown) => {
    if (!raw || typeof raw !== 'object') {
      return { ok: false, error: 'invalid payload' }
    }
    const r = raw as Partial<PersistRequest>
    if (
      typeof r.sessionId !== 'string' ||
      typeof r.artifactId !== 'string' ||
      typeof r.kind !== 'string' ||
      typeof r.updatedAt !== 'number'
    ) {
      return { ok: false, error: 'missing required fields' }
    }
    if (!isSafeId(r.sessionId) || !isSafeId(r.artifactId)) {
      return { ok: false, error: 'unsafe id (only [A-Za-z0-9_-] allowed)' }
    }
    return serialized(async () => {
      const doc: StoredFile = {
        version: 1,
        sessionId: r.sessionId as string,
        artifactId: r.artifactId as string,
        payload: r.payload,
        kind: r.kind as string,
        updatedAt: r.updatedAt as number,
      }
      try {
        await writeAtomic(
          filePath(doc.sessionId, doc.artifactId),
          JSON.stringify(doc, null, 2),
        )
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    })
  })

  ipcMain.handle('research:delete', async (_e, raw: unknown) => {
    const r = raw as { sessionId?: unknown; artifactId?: unknown }
    if (typeof r?.sessionId !== 'string' || typeof r?.artifactId !== 'string') {
      return { ok: false, error: 'sessionId and artifactId required' }
    }
    if (!isSafeId(r.sessionId) || !isSafeId(r.artifactId)) {
      return { ok: false, error: 'unsafe id' }
    }
    return serialized(async () => {
      try {
        await fs.unlink(filePath(r.sessionId as string, r.artifactId as string))
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (code !== 'ENOENT') {
          return { ok: false, error: (err as Error).message }
        }
      }
      return { ok: true }
    })
  })

  ipcMain.handle('research:list', async () => {
    try {
      const root = researchRoot()
      await fs.mkdir(root, { recursive: true })
      const items: StoredFile[] = []
      const sessionDirs = await fs.readdir(root, { withFileTypes: true })
      for (const sDir of sessionDirs) {
        if (!sDir.isDirectory()) continue
        if (!isSafeId(sDir.name)) continue
        const sDirAbs = path.join(root, sDir.name)
        const files = await fs.readdir(sDirAbs, { withFileTypes: true })
        for (const entry of files) {
          if (!entry.isFile() || !entry.name.endsWith('.json')) continue
          try {
            const raw = await fs.readFile(path.join(sDirAbs, entry.name), 'utf8')
            const parsed = JSON.parse(raw) as Partial<StoredFile>
            if (
              typeof parsed.sessionId === 'string' &&
              typeof parsed.artifactId === 'string' &&
              typeof parsed.kind === 'string' &&
              typeof parsed.updatedAt === 'number'
            ) {
              items.push({
                version: 1,
                sessionId: parsed.sessionId,
                artifactId: parsed.artifactId,
                payload: parsed.payload,
                kind: parsed.kind,
                updatedAt: parsed.updatedAt,
              })
            }
          } catch {
            // corrupt file — skip, don't fail the whole boot
          }
        }
      }
      return { ok: true, items }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
}
