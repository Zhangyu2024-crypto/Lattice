import { create } from 'zustand'
import {
  getWorkspaceFs,
  type FsEntry,
  type IWorkspaceFs,
  type LatticeFileKind,
  type WatchEvent,
} from '../lib/workspace/fs'
import { fileKindFromName } from '../lib/workspace/file-kind'

export type IndexedEntry = FsEntry & { kind?: LatticeFileKind }

/**
 * In-memory staging buffer for streaming file payloads that have not yet been
 * committed to disk. Phase 4b uses this to aggregate streaming chat messages:
 * each `chat_message` / `chat_message_update` event rewrites the entire
 * payload (not an incremental patch) into `dirtyBuffer[relPath].data`, and
 * ChatFileEditor subscribes to the slot so the UI reflects partial deltas
 * without re-reading from disk on every token. When the terminal frame
 * arrives, the WS layer writes the envelope atomically and clears the slot
 * with `clearDirty`.
 *
 * The value is intentionally `unknown` — consumers cast to the kind-specific
 * payload shape they care about. We avoid a generic parameter here because
 * the store is a single shared slot keyed by relPath and may hold payloads
 * of mixed kinds during a session.
 */
export interface DirtyBufferEntry {
  data: unknown
  savedAt: number
}

interface WorkspaceState {
  rootPath: string | null
  hydrated: boolean
  loading: boolean
  error: string | null
  fileIndex: Record<string, IndexedEntry>
  // Phase 1 stub — Phase 5 will persist to `.lattice/workspace.json`.
  recentFiles: string[]
  /** See {@link DirtyBufferEntry} — keyed by POSIX relative path. */
  dirtyBuffer: Record<string, DirtyBufferEntry>

  hydrate: () => Promise<void>
  setRoot: (rootPath: string | null) => Promise<void>
  refreshDir: (rel: string) => Promise<void>
  readFile: (rel: string) => Promise<string | null>
  readBinary: (rel: string) => Promise<ArrayBuffer | null>
  writeFile: (rel: string, content: string) => Promise<void>
  renameEntry: (from: string, to: string) => Promise<void>
  deleteEntry: (rel: string, toTrash?: boolean) => Promise<void>
  createFolder: (rel: string) => Promise<void>
  applyWatchEvent: (event: WatchEvent) => void
  /** Shared filesystem instance. Exposed so non-React callers (eg. WS
   *  handlers in Phase 3) can persist envelopes without re-resolving the
   *  singleton. */
  getFs: () => IWorkspaceFs
  /** Overwrite the dirty payload for `relPath`. `savedAt` is always stamped
   *  to `Date.now()` so subscribers can re-render; pass the full payload
   *  (not a delta) — this store does not merge. */
  setDirty: (relPath: string, data: unknown) => void
  /** Remove the dirty slot for `relPath`. Idempotent — calling on a missing
   *  key is a no-op. */
  clearDirty: (relPath: string) => void
}

function posixDirname(rel: string): string {
  const idx = rel.lastIndexOf('/')
  return idx < 0 ? '' : rel.slice(0, idx)
}

function posixBasename(rel: string): string {
  const idx = rel.lastIndexOf('/')
  return idx < 0 ? rel : rel.slice(idx + 1)
}

function withKind(entry: FsEntry): IndexedEntry {
  if (entry.isDirectory) return { ...entry }
  return { ...entry, kind: fileKindFromName(entry.name) }
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  rootPath: null,
  hydrated: false,
  loading: false,
  error: null,
  fileIndex: {},
  recentFiles: [],
  dirtyBuffer: {},

  hydrate: async () => {
    if (get().hydrated) return
    set({ loading: true, error: null })
    try {
      const fs = getWorkspaceFs()
      const rp = await fs.getRoot()
      if (rp) {
        set({ rootPath: rp })
        const entries = await fs.listDir('')
        const indexed: Record<string, IndexedEntry> = {}
        for (const e of entries) indexed[e.relPath] = withKind(e)
        set({ fileIndex: indexed })
      }
      set({ hydrated: true, loading: false })
    } catch (err) {
      set({
        hydrated: true,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },

  setRoot: async (rootPath) => {
    const fs = getWorkspaceFs()
    set({ loading: true, error: null })
    try {
      if (rootPath == null) {
        set({ rootPath: null, fileIndex: {}, loading: false })
        return
      }
      const applied = await fs.setRoot(rootPath)
      set({ rootPath: applied, fileIndex: {} })
      const entries = await fs.listDir('')
      const indexed: Record<string, IndexedEntry> = {}
      for (const e of entries) indexed[e.relPath] = withKind(e)
      set({ fileIndex: indexed, loading: false })
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  },

  refreshDir: async (rel) => {
    const fs = getWorkspaceFs()
    if (!get().rootPath) return
    const dir = rel.replace(/^\/+|\/+$/g, '')
    const entries = await fs.listDir(dir)
    set((state) => {
      const next: Record<string, IndexedEntry> = {}
      // Drop stale entries that live directly under `dir`; keep the rest.
      for (const [k, v] of Object.entries(state.fileIndex)) {
        if (v.parentRel !== dir) next[k] = v
      }
      for (const e of entries) next[e.relPath] = withKind(e)
      return { fileIndex: next }
    })
  },

  readFile: async (rel) => {
    const fs = getWorkspaceFs()
    try {
      return await fs.readText(rel)
    } catch {
      return null
    }
  },

  readBinary: async (rel) => {
    const fs = getWorkspaceFs()
    try {
      return await fs.readBinary(rel)
    } catch {
      return null
    }
  },

  writeFile: async (rel, content) => {
    const fs = getWorkspaceFs()
    await fs.writeText(rel, content)
    await get().refreshDir(posixDirname(rel))
  },

  renameEntry: async (from, to) => {
    const fs = getWorkspaceFs()
    await fs.rename(from, to)
    const fromDir = posixDirname(from)
    const toDir = posixDirname(to)
    await get().refreshDir(fromDir)
    if (toDir !== fromDir) await get().refreshDir(toDir)
  },

  deleteEntry: async (rel, toTrash = true) => {
    const fs = getWorkspaceFs()
    await fs.delete(rel, { toTrash })
    await get().refreshDir(posixDirname(rel))
  },

  createFolder: async (rel) => {
    const fs = getWorkspaceFs()
    await fs.mkdir(rel)
    await get().refreshDir(posixDirname(rel))
  },

  getFs: () => getWorkspaceFs(),

  setDirty: (relPath, data) => {
    set((state) => ({
      dirtyBuffer: {
        ...state.dirtyBuffer,
        [relPath]: { data, savedAt: Date.now() },
      },
    }))
  },

  clearDirty: (relPath) => {
    set((state) => {
      if (!state.dirtyBuffer[relPath]) return {}
      const next = { ...state.dirtyBuffer }
      delete next[relPath]
      return { dirtyBuffer: next }
    })
  },

  applyWatchEvent: (event) => {
    if (event.type === 'ready') return
    // chokidar fires events after the debounced atomic write lands; a
    // targeted parent-dir refresh keeps fileIndex simple (no per-event
    // stat call) and covers add/change/unlink uniformly.
    const rel =
      event.type === 'add' || event.type === 'unlink'
        ? event.relPath
        : event.relPath
    const parent = posixDirname(rel)
    // Defer to async refresh to pick up the new entry stat data.
    void get()
      .refreshDir(parent)
      .catch(() => {
        // swallow — Explorer will re-reconcile on next event.
      })

    if (event.type === 'add' || event.type === 'change') {
      void import('./data-index-store').then(({ useDataIndexStore }) => {
        void useDataIndexStore.getState().autoDetectFile(rel)
      })
    }

    void posixBasename
  },
}))
