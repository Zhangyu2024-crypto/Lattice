import { create } from 'zustand'
import { genShortId } from '../lib/id-gen'
import { extractElement } from '../lib/artifact-db-extract'
import {
  dbIdbPutEntry,
  dbIdbDeleteEntry,
  dbIdbGetEntry,
  dbIdbPutMeta,
} from '../lib/artifact-db-idb'
import type { Artifact, ArtifactId } from '../types/artifact'
import type { MentionElementKind } from '../types/mention'
import type {
  CollectionId,
  DbCollection,
  DbEntry,
  DbEntryId,
  DbFilter,
  DbIndexEntry,
  DbIndexRoot,
} from '../types/artifact-db'
import { EMPTY_DB_FILTER } from '../types/artifact-db'

const LS_KEY = 'lattice.db-index'
const INDEX_VERSION = 1
const FLUSH_DEBOUNCE_MS = 300

// ── helpers ──────────────────────────────────────────────────────────

function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value) } catch { /* fall through */ }
  }
  return JSON.parse(JSON.stringify(value)) as T
}

function estimateSize(payload: unknown): number {
  try { return JSON.stringify(payload).length } catch { return 0 }
}

function toIndexEntry(e: DbEntry): DbIndexEntry {
  return {
    id: e.id,
    sourceArtifactKind: e.sourceArtifactKind,
    element: e.element
      ? { elementKind: e.element.elementKind, label: e.element.label }
      : undefined,
    title: e.title,
    tags: e.tags,
    rating: e.rating,
    collectionIds: e.collectionIds,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    payloadSizeEstimate: e.payloadSizeEstimate,
  }
}

function readIndex(): DbIndexRoot | null {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    return JSON.parse(raw) as DbIndexRoot
  } catch {
    return null
  }
}

// ── store ────────────────────────────────────────────────────────────

interface ArtifactDbState {
  index: DbIndexEntry[]
  collections: DbCollection[]
  globalTags: string[]
  hydrated: boolean

  filter: DbFilter
  selectedEntryId: DbEntryId | null

  // lifecycle
  hydrate: () => Promise<void>

  // whole-artifact bookmark
  bookmarkArtifact: (
    artifact: Artifact,
    sessionId: string,
    sessionTitle: string,
  ) => Promise<DbEntryId>

  // sub-element bookmark
  bookmarkElement: (
    artifact: Artifact,
    sessionId: string,
    sessionTitle: string,
    elementKind: MentionElementKind,
    elementId: string,
  ) => Promise<DbEntryId | null>

  // CRUD
  updateEntry: (
    id: DbEntryId,
    patch: Partial<Pick<DbEntry, 'title' | 'tags' | 'rating' | 'notes' | 'collectionIds'>>,
  ) => Promise<void>
  removeEntry: (id: DbEntryId) => Promise<void>
  getFullEntry: (id: DbEntryId) => Promise<DbEntry | null>

  // collections
  createCollection: (name: string, description?: string) => CollectionId
  updateCollection: (
    id: CollectionId,
    patch: Partial<Pick<DbCollection, 'name' | 'description' | 'color'>>,
  ) => void
  deleteCollection: (id: CollectionId) => void

  // tags
  addGlobalTag: (tag: string) => void
  removeGlobalTag: (tag: string) => void
  tagEntry: (entryId: DbEntryId, tag: string) => Promise<void>
  untagEntry: (entryId: DbEntryId, tag: string) => Promise<void>

  // filter (transient)
  setFilter: (patch: Partial<DbFilter>) => void
  resetFilter: () => void
  setSelectedEntryId: (id: DbEntryId | null) => void
}

let flushTimer: ReturnType<typeof setTimeout> | null = null

function scheduleFlush(get: () => ArtifactDbState) {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    flushTimer = null
    flushIndexToLocalStorage(get())
  }, FLUSH_DEBOUNCE_MS)
}

function flushIndexToLocalStorage(state: ArtifactDbState) {
  const root: DbIndexRoot = {
    version: INDEX_VERSION,
    entries: state.index,
    collections: state.collections,
    globalTags: state.globalTags,
  }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(root))
  } catch {
    // localStorage full — entries still live in IDB
  }
}

function flushMetaToIdb(state: ArtifactDbState) {
  void dbIdbPutMeta({
    collections: state.collections,
    globalTags: state.globalTags,
  })
}

export const useArtifactDbStore = create<ArtifactDbState>()((set, get) => ({
  index: [],
  collections: [],
  globalTags: [],
  hydrated: false,
  filter: { ...EMPTY_DB_FILTER },
  selectedEntryId: null,

  hydrate: async () => {
    const cached = readIndex()
    if (cached && cached.version === INDEX_VERSION) {
      set({
        index: cached.entries,
        collections: cached.collections,
        globalTags: cached.globalTags,
        hydrated: true,
      })
    } else {
      set({ hydrated: true })
    }
  },

  bookmarkArtifact: async (artifact, sessionId, sessionTitle) => {
    const id = genShortId('dbe', 6)
    const now = Date.now()
    const payload = deepClone(artifact.payload)
    const entry: DbEntry = {
      id,
      sourceArtifactKind: artifact.kind,
      title: artifact.title,
      payload,
      source: {
        sessionId,
        artifactId: artifact.id,
        sessionTitle,
        sourceFile: artifact.sourceFile,
      },
      tags: [],
      notes: '',
      collectionIds: [],
      createdAt: now,
      updatedAt: now,
      payloadSizeEstimate: estimateSize(payload),
    }

    await dbIdbPutEntry(entry)
    set((s) => ({ index: [toIndexEntry(entry), ...s.index] }))
    scheduleFlush(get)
    return id
  },

  bookmarkElement: async (artifact, sessionId, sessionTitle, elementKind, elementId) => {
    const result = extractElement(artifact, elementKind, elementId)
    if (!result) return null

    const id = genShortId('dbe', 6)
    const now = Date.now()
    const entry: DbEntry = {
      id,
      sourceArtifactKind: artifact.kind,
      element: { elementKind, elementId, label: result.label },
      title: result.label,
      payload: result.payload,
      source: {
        sessionId,
        artifactId: artifact.id,
        sessionTitle,
        sourceFile: artifact.sourceFile,
      },
      tags: [],
      notes: '',
      collectionIds: [],
      createdAt: now,
      updatedAt: now,
      payloadSizeEstimate: result.sizeEstimate,
    }

    await dbIdbPutEntry(entry)
    set((s) => ({ index: [toIndexEntry(entry), ...s.index] }))
    scheduleFlush(get)
    return id
  },

  updateEntry: async (id, patch) => {
    const now = Date.now()
    set((s) => ({
      index: s.index.map((e) =>
        e.id === id
          ? {
              ...e,
              ...(patch.title != null ? { title: patch.title } : {}),
              ...(patch.tags != null ? { tags: patch.tags } : {}),
              ...(patch.rating !== undefined ? { rating: patch.rating } : {}),
              ...(patch.collectionIds != null ? { collectionIds: patch.collectionIds } : {}),
              updatedAt: now,
            }
          : e,
      ),
    }))
    scheduleFlush(get)

    const full = await dbIdbGetEntry(id)
    if (full) {
      const updated = { ...full, ...patch, updatedAt: now }
      await dbIdbPutEntry(updated)
    }
  },

  removeEntry: async (id) => {
    set((s) => ({
      index: s.index.filter((e) => e.id !== id),
      selectedEntryId: s.selectedEntryId === id ? null : s.selectedEntryId,
    }))
    scheduleFlush(get)
    await dbIdbDeleteEntry(id)
  },

  getFullEntry: (id) => dbIdbGetEntry(id),

  createCollection: (name, description) => {
    const id = genShortId('col', 5)
    const now = Date.now()
    const col: DbCollection = {
      id,
      name,
      description: description ?? '',
      createdAt: now,
      updatedAt: now,
    }
    set((s) => ({ collections: [...s.collections, col] }))
    scheduleFlush(get)
    flushMetaToIdb(get())
    return id
  },

  updateCollection: (id, patch) => {
    set((s) => ({
      collections: s.collections.map((c) =>
        c.id === id ? { ...c, ...patch, updatedAt: Date.now() } : c,
      ),
    }))
    scheduleFlush(get)
    flushMetaToIdb(get())
  },

  deleteCollection: (id) => {
    set((s) => ({
      collections: s.collections.filter((c) => c.id !== id),
      index: s.index.map((e) =>
        e.collectionIds.includes(id)
          ? { ...e, collectionIds: e.collectionIds.filter((c) => c !== id) }
          : e,
      ),
    }))
    scheduleFlush(get)
    flushMetaToIdb(get())
  },

  addGlobalTag: (tag) => {
    const t = tag.trim().toLowerCase()
    if (!t) return
    set((s) =>
      s.globalTags.includes(t) ? s : { globalTags: [...s.globalTags, t] },
    )
    scheduleFlush(get)
    flushMetaToIdb(get())
  },

  removeGlobalTag: (tag) => {
    set((s) => ({ globalTags: s.globalTags.filter((t) => t !== tag) }))
    scheduleFlush(get)
    flushMetaToIdb(get())
  },

  tagEntry: async (entryId, tag) => {
    const t = tag.trim().toLowerCase()
    if (!t) return
    const s = get()
    if (!s.globalTags.includes(t)) {
      s.addGlobalTag(t)
    }
    await s.updateEntry(entryId, {
      tags: [...new Set([...(s.index.find((e) => e.id === entryId)?.tags ?? []), t])],
    })
  },

  untagEntry: async (entryId, tag) => {
    const entry = get().index.find((e) => e.id === entryId)
    if (!entry) return
    await get().updateEntry(entryId, {
      tags: entry.tags.filter((t) => t !== tag),
    })
  },

  setFilter: (patch) =>
    set((s) => ({ filter: { ...s.filter, ...patch } })),

  resetFilter: () => set({ filter: { ...EMPTY_DB_FILTER } }),

  setSelectedEntryId: (id) => set({ selectedEntryId: id }),
}))

// ── query helper (pure function, no store mutation) ──────────────────

export function queryDbEntries(
  index: DbIndexEntry[],
  filter: DbFilter,
): DbIndexEntry[] {
  let result = index

  if (filter.search) {
    const q = filter.search.toLowerCase()
    result = result.filter((e) => e.title.toLowerCase().includes(q))
  }
  if (filter.tags.length > 0) {
    result = result.filter((e) =>
      filter.tags.every((t) => e.tags.includes(t)),
    )
  }
  if (filter.artifactKinds.length > 0) {
    result = result.filter((e) =>
      filter.artifactKinds.includes(e.sourceArtifactKind),
    )
  }
  if (filter.elementKinds.length > 0) {
    result = result.filter(
      (e) => e.element && filter.elementKinds.includes(e.element.elementKind),
    )
  }
  if (filter.collectionIds.length > 0) {
    result = result.filter((e) =>
      filter.collectionIds.some((c) => e.collectionIds.includes(c)),
    )
  }
  if (filter.rating != null) {
    result = result.filter((e) => (e.rating ?? 0) >= filter.rating!)
  }

  const dir = filter.sortOrder === 'asc' ? 1 : -1
  result = [...result].sort((a, b) => {
    switch (filter.sortBy) {
      case 'title':
        return dir * a.title.localeCompare(b.title)
      case 'rating':
        return dir * ((a.rating ?? 0) - (b.rating ?? 0))
      case 'updatedAt':
        return dir * (a.updatedAt - b.updatedAt)
      case 'createdAt':
      default:
        return dir * (a.createdAt - b.createdAt)
    }
  })

  return result
}

// ── flush on page unload ─────────────────────────────────────────────

if (typeof window !== 'undefined') {
  const flush = () => {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
      flushIndexToLocalStorage(useArtifactDbStore.getState())
    }
  }
  window.addEventListener('beforeunload', flush)
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
}
