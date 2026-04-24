// Local library CRUD — JSON-file backed replacement for a subset of
// lattice-cli's `/api/library/*` endpoints. Stores papers under
// `app.getPath('userData')/library/library.json` as a single record so
// a read is one fs call; writes go through an atomic tmp+rename to avoid
// a partial file if the app crashes mid-save.
//
// Self-contained Port Plan §P3 (v1): only the two methods
// `InverseDesignCard` actually calls are wired end-to-end (`list` and
// `add`). Tags, collections, annotations, DOI import, PDF viewer,
// question-answering and the LibraryModal consumer surface all stay on
// the existing REST path until future phases migrate them one at a time.

import { app, ipcMain, net } from 'electron'
import fs from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  extractDoiCandidatesFromStem,
  fetchCrossrefByDoi,
  libraryDoiKey,
  normalizeDoi,
  pickBestDoiCandidate,
  resolvePdfStemViaCrossref,
} from './crossref-metadata'

interface StoredLibraryPaper {
  id: number
  title: string
  title_norm?: string
  authors: string
  year: string
  doi?: string
  url?: string
  journal?: string
  abstract?: string
  source?: string
  citation_count?: number
  bib_key?: string
  notes?: string
  pdf_path?: string
  created_at?: string
  updated_at?: string
  tags: string[]
  collections: string[]
}

interface StoredCollection {
  description: string
  created_at: string
}

interface StoredAnnotation {
  id: number
  paper_id: number
  page: number
  type: string
  color: string
  content: string
  rects: Array<{ x: number; y: number; width: number; height: number }>
  created_at: string
  updated_at: string
}

interface StoredLibrary {
  version: 3
  nextId: number
  nextAnnotationId: number
  papers: StoredLibraryPaper[]
  /** Named collections with metadata. Paper membership lives on the paper
   *  (`paper.collections: string[]`); this index tracks description +
   *  creation time so empty collections survive and `listCollections`
   *  returns the full set even when nothing is in them yet. */
  collections: Record<string, StoredCollection>
  /** Annotations keyed by paper id. Stored nested so a paper-scoped read
   *  is O(papers) rather than O(all annotations); P3 v3 scale is tiny so
   *  either layout is fine. */
  annotations: Record<number, StoredAnnotation[]>
}

interface AddPaperInput {
  title?: unknown
  authors?: unknown
  year?: unknown
  doi?: unknown
  url?: unknown
  journal?: unknown
  abstract?: unknown
  notes?: unknown
  tags?: unknown
  collection?: unknown
}

interface ListPapersQuery {
  q?: unknown
  tag?: unknown
  year?: unknown
  collection?: unknown
  page?: unknown
  limit?: unknown
  sort?: unknown
  order?: unknown
}

let registered = false

/**
 * Promise-chain mutex. IPC handlers run concurrently by default, so two
 * rapid `add-paper` calls would both `readLibrary`, both allocate the
 * same `nextId`, and the later `writeLibrary` would clobber the earlier.
 * Serialising every write-side operation through a single tail promise is
 * lighter than pulling in a real mutex library and closes the race for
 * the single-process, single-user case this IPC is designed for.
 */
let writeTail: Promise<unknown> = Promise.resolve()
async function serialized<T>(task: () => Promise<T>): Promise<T> {
  const prior = writeTail
  let release!: () => void
  writeTail = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    // Await the previous task's completion (or error — we don't care; any
    // failure in the prior task has already surfaced to its own caller).
    await prior.catch(() => undefined)
    return await task()
  } finally {
    release()
  }
}

function libraryDir(): string {
  return path.join(app.getPath('userData'), 'library')
}

function libraryPath(): string {
  return path.join(libraryDir(), 'library.json')
}

function nowIso(): string {
  return new Date().toISOString()
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function asYearString(v: unknown): string {
  if (typeof v === 'string' && v.length > 0) return v
  if (typeof v === 'number' && Number.isFinite(v)) return String(Math.floor(v))
  return ''
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((item): item is string => typeof item === 'string' && item.length > 0)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ')
}

async function ensureLibraryDir(): Promise<void> {
  await fs.mkdir(libraryDir(), { recursive: true })
}

function emptyLibrary(): StoredLibrary {
  return {
    version: 3,
    nextId: 1,
    nextAnnotationId: 1,
    papers: [],
    collections: {},
    annotations: {},
  }
}

function normalizeAnnotationsMap(raw: unknown): Record<number, StoredAnnotation[]> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<number, StoredAnnotation[]> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const paperId = Number.parseInt(key, 10)
    if (!Number.isFinite(paperId)) continue
    if (!Array.isArray(value)) continue
    out[paperId] = value.filter(
      (a): a is StoredAnnotation =>
        Boolean(a) &&
        typeof a === 'object' &&
        typeof (a as { id?: unknown }).id === 'number',
    )
  }
  return out
}

function normalizeCollectionsIndex(raw: unknown): Record<string, StoredCollection> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, StoredCollection> = {}
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const v = value as Record<string, unknown>
    out[name] = {
      description: typeof v.description === 'string' ? v.description : '',
      created_at: typeof v.created_at === 'string' ? v.created_at : nowIso(),
    }
  }
  return out
}

async function readLibrary(): Promise<StoredLibrary> {
  try {
    const raw = await fs.readFile(libraryPath(), 'utf8')
    const data = JSON.parse(raw) as Partial<StoredLibrary> & { version?: number }
    if (!data || !Array.isArray(data.papers)) return emptyLibrary()

    const papers = data.papers
      .filter(
        (p): p is StoredLibraryPaper =>
          Boolean(p) && typeof p === 'object' && typeof p.id === 'number',
      )
      .map((p) => ({
        ...p,
        tags: Array.isArray(p.tags) ? p.tags : [],
        collections: Array.isArray(p.collections) ? p.collections : [],
      }))

    const nextId =
      typeof data.nextId === 'number' && data.nextId > 0
        ? Math.floor(data.nextId)
        : 1

    // v1 → v2 migrate (no collections index yet) — seed the index from
    // whatever membership is already on papers so listCollections isn't
    // empty after upgrade. v2 → v3 migrate adds the annotations map +
    // nextAnnotationId counter. Old versions land on the same code path;
    // missing fields default to empty.
    // The literal `version: 3` on StoredLibrary narrows TS away from
    // accepting older numeric values; widen via `as number` so the
    // migrate branch can match real on-disk v1/v2 records.
    const persistedVersion = (data as { version?: number }).version as
      | number
      | undefined
    const collections =
      persistedVersion === 2 || persistedVersion === 3
        ? normalizeCollectionsIndex(
            (data as Partial<StoredLibrary>).collections,
          )
        : (() => {
            const seeded: Record<string, StoredCollection> = {}
            for (const paper of papers) {
              for (const name of paper.collections) {
                if (!seeded[name]) {
                  seeded[name] = { description: '', created_at: nowIso() }
                }
              }
            }
            return seeded
          })()

    const annotations =
      persistedVersion === 3
        ? normalizeAnnotationsMap((data as Partial<StoredLibrary>).annotations)
        : {}
    const nextAnnotationId =
      typeof (data as Partial<StoredLibrary>).nextAnnotationId === 'number' &&
      (data as Partial<StoredLibrary>).nextAnnotationId! > 0
        ? Math.floor((data as Partial<StoredLibrary>).nextAnnotationId!)
        : Math.max(
            1,
            ...Object.values(annotations).flatMap((list) =>
              list.map((a) => a.id + 1),
            ),
          )

    return {
      version: 3,
      nextId,
      nextAnnotationId,
      papers,
      collections,
      annotations,
    }
  } catch (err) {
    const code = (err as { code?: string })?.code
    if (code === 'ENOENT') return emptyLibrary()
    throw err
  }
}

async function writeLibrary(lib: StoredLibrary): Promise<void> {
  await ensureLibraryDir()
  const target = libraryPath()
  const tmp = `${target}.tmp`
  await fs.writeFile(tmp, JSON.stringify(lib, null, 2), 'utf8')
  await fs.rename(tmp, target)
}

function matchesQuery(paper: StoredLibraryPaper, q: string): boolean {
  if (q.length === 0) return true
  const needle = q.toLowerCase()
  return (
    paper.title.toLowerCase().includes(needle) ||
    paper.authors.toLowerCase().includes(needle) ||
    (paper.abstract?.toLowerCase().includes(needle) ?? false) ||
    (paper.journal?.toLowerCase().includes(needle) ?? false) ||
    (paper.doi?.toLowerCase().includes(needle) ?? false)
  )
}

function sortPapers(
  papers: StoredLibraryPaper[],
  sort: string,
  order: 'asc' | 'desc',
): StoredLibraryPaper[] {
  const key: keyof StoredLibraryPaper =
    sort === 'year' ||
    sort === 'title' ||
    sort === 'authors' ||
    sort === 'id'
      ? sort
      : 'updated_at'
  const multiplier = order === 'asc' ? 1 : -1
  return [...papers].sort((a, b) => {
    const av = (a[key] ?? '') as string | number
    const bv = (b[key] ?? '') as string | number
    if (av < bv) return -1 * multiplier
    if (av > bv) return 1 * multiplier
    return 0
  })
}

export function registerLibraryIpc(): void {
  if (registered) return
  registered = true

  ipcMain.handle('library:get-paper', async (_event, rawId: unknown) => {
    try {
      const id = typeof rawId === 'number' ? rawId : Number(rawId)
      if (!Number.isFinite(id)) {
        return { paper: null, error: 'id must be a number' }
      }
      const lib = await readLibrary()
      const paper = lib.papers.find((p) => p.id === id) ?? null
      return { paper }
    } catch (err) {
      return {
        paper: null,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  })

  ipcMain.handle('library:list-papers', async (_event, rawQuery: unknown) => {
    try {
      const query = (rawQuery ?? {}) as ListPapersQuery
      const lib = await readLibrary()
      const q = typeof query.q === 'string' ? query.q.trim() : ''
      const tagFilter = asString(query.tag)
      const yearFilter = asString(query.year)
      const collectionFilter = asString(query.collection)
      const sort = typeof query.sort === 'string' ? query.sort : 'updated_at'
      const order: 'asc' | 'desc' = query.order === 'asc' ? 'asc' : 'desc'
      const page =
        typeof query.page === 'number' && query.page > 0
          ? Math.floor(query.page)
          : 1
      const limit =
        typeof query.limit === 'number' && query.limit > 0
          ? Math.min(Math.floor(query.limit), 500)
          : 50

      const filtered = lib.papers.filter((paper) => {
        if (!matchesQuery(paper, q)) return false
        if (tagFilter && !paper.tags.includes(tagFilter)) return false
        if (yearFilter && paper.year !== yearFilter) return false
        if (collectionFilter && !paper.collections.includes(collectionFilter)) {
          return false
        }
        return true
      })
      const sorted = sortPapers(filtered, sort, order)
      const start = (page - 1) * limit
      const pageRows = sorted.slice(start, start + limit)
      return { papers: pageRows, total: filtered.length }
    } catch (err) {
      return {
        papers: [],
        total: 0,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  })

  ipcMain.handle('library:add-paper', async (_event, rawInput: unknown) => {
    const input = (rawInput ?? {}) as AddPaperInput
    const title = asString(input.title)?.trim()
    const authors = asString(input.authors)?.trim()
    if (!title || !authors) {
      return {
        success: false,
        error: 'title and authors are required',
      }
    }
    return await serialized(async () => {
      try {
        const lib = await readLibrary()
        // De-dupe on normalized title — the lattice-cli backend uses a
        // similar check. Users who deliberately want a duplicate can edit
        // the title to disambiguate.
        const norm = normalizeTitle(title)
        const existing = lib.papers.find((p) => p.title_norm === norm)
        if (existing) {
          return { success: true, id: existing.id }
        }
        const id = lib.nextId
        const created = nowIso()
        const paper: StoredLibraryPaper = {
          id,
          title,
          title_norm: norm,
          authors,
          year: asYearString(input.year),
          doi: asString(input.doi),
          url: asString(input.url),
          journal: asString(input.journal),
          abstract: asString(input.abstract),
          notes: asString(input.notes),
          source: 'local',
          tags: asStringArray(input.tags),
          collections: [
            ...(asString(input.collection) ? [asString(input.collection)!] : []),
          ],
          created_at: created,
          updated_at: created,
        }
        lib.papers.push(paper)
        lib.nextId = id + 1
        await writeLibrary(lib)
        return { success: true, id }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    })
  })

  ipcMain.handle('library:delete-paper', async (_event, rawId: unknown) => {
    const id = typeof rawId === 'number' ? rawId : null
    if (id == null || !Number.isFinite(id)) {
      return { success: false, error: 'Invalid paper id' }
    }
    return await serialized(async () => {
      try {
        const lib = await readLibrary()
        const before = lib.papers.length
        lib.papers = lib.papers.filter((p) => p.id !== id)
        if (lib.papers.length === before) {
          return { success: false, error: `Paper not found: ${id}` }
        }
        await writeLibrary(lib)
        return { success: true }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    })
  })

  ipcMain.handle('library:list-tags', async () => {
    try {
      const lib = await readLibrary()
      const counts = new Map<string, number>()
      for (const paper of lib.papers) {
        for (const tag of paper.tags) {
          counts.set(tag, (counts.get(tag) ?? 0) + 1)
        }
      }
      // Sort by count desc, tie-break alphabetical — the UI lists this in
      // a sidebar and users expect "most-used first".
      return Array.from(counts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    } catch {
      return []
    }
  })

  ipcMain.handle('library:add-tag', async (_event, rawId: unknown, rawTag: unknown) => {
    const paperId = typeof rawId === 'number' ? rawId : null
    const tag = asString(rawTag)?.trim()
    if (paperId == null || !tag) {
      return { success: false, error: 'paperId and tag are required' }
    }
    return await serialized(async () => {
      try {
        const lib = await readLibrary()
        const paper = lib.papers.find((p) => p.id === paperId)
        if (!paper) return { success: false, error: `Paper not found: ${paperId}` }
        if (!paper.tags.includes(tag)) {
          paper.tags = [...paper.tags, tag]
          paper.updated_at = nowIso()
          await writeLibrary(lib)
        }
        return { success: true }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    })
  })

  ipcMain.handle(
    'library:remove-tag',
    async (_event, rawId: unknown, rawTag: unknown) => {
      const paperId = typeof rawId === 'number' ? rawId : null
      const tag = asString(rawTag)?.trim()
      if (paperId == null || !tag) {
        return { success: false, error: 'paperId and tag are required' }
      }
      return await serialized(async () => {
        try {
          const lib = await readLibrary()
          const paper = lib.papers.find((p) => p.id === paperId)
          if (!paper) {
            return { success: false, error: `Paper not found: ${paperId}` }
          }
          const before = paper.tags.length
          paper.tags = paper.tags.filter((t) => t !== tag)
          if (paper.tags.length !== before) {
            paper.updated_at = nowIso()
            await writeLibrary(lib)
          }
          return { success: true }
        } catch (err) {
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          }
        }
      })
    },
  )

  ipcMain.handle('library:list-collections', async () => {
    try {
      const lib = await readLibrary()
      const counts = new Map<string, number>()
      for (const paper of lib.papers) {
        for (const name of paper.collections) {
          counts.set(name, (counts.get(name) ?? 0) + 1)
        }
      }
      return Object.entries(lib.collections).map(([name, meta]) => ({
        name,
        description: meta.description,
        count: counts.get(name) ?? 0,
      }))
    } catch {
      return []
    }
  })

  ipcMain.handle(
    'library:create-collection',
    async (_event, rawInput: unknown) => {
      const input = (rawInput ?? {}) as { name?: unknown; description?: unknown }
      const name = asString(input.name)?.trim()
      if (!name) {
        return { success: false, error: 'name is required' }
      }
      const description = asString(input.description) ?? ''
      return await serialized(async () => {
        try {
          const lib = await readLibrary()
          if (lib.collections[name]) {
            return { success: false, error: `Collection already exists: ${name}` }
          }
          lib.collections[name] = { description, created_at: nowIso() }
          await writeLibrary(lib)
          // No real DB row id to echo; use a stable positive-int hash of
          // the name so the response fits the `CreateCollectionResponse`
          // shape (which expects a number) without introducing churn.
          const id =
            Math.abs(
              Array.from(name).reduce(
                (hash, ch) => (hash * 31 + ch.charCodeAt(0)) >>> 0,
                0,
              ),
            ) || 1
          return { success: true, id }
        } catch (err) {
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          }
        }
      })
    },
  )

  ipcMain.handle('library:delete-collection', async (_event, rawName: unknown) => {
    const name = asString(rawName)?.trim()
    if (!name) return { success: false }
    return await serialized(async () => {
      try {
        const lib = await readLibrary()
        if (!lib.collections[name]) return { success: true }
        delete lib.collections[name]
        // Purge membership from all papers so stale references don't leak
        // back when the user later lists the (now deleted) collection.
        const now = nowIso()
        for (const paper of lib.papers) {
          if (paper.collections.includes(name)) {
            paper.collections = paper.collections.filter((c) => c !== name)
            paper.updated_at = now
          }
        }
        await writeLibrary(lib)
        return { success: true }
      } catch {
        return { success: false }
      }
    })
  })

  ipcMain.handle(
    'library:add-to-collection',
    async (_event, rawName: unknown, rawId: unknown) => {
      const name = asString(rawName)?.trim()
      const paperId = typeof rawId === 'number' ? rawId : null
      if (!name || paperId == null) return { success: false }
      return await serialized(async () => {
        try {
          const lib = await readLibrary()
          const paper = lib.papers.find((p) => p.id === paperId)
          if (!paper) return { success: false }
          // Auto-create the collection entry if it wasn't declared via
          // createCollection — matches the lattice-cli behaviour of
          // tolerating ad-hoc collection names.
          if (!lib.collections[name]) {
            lib.collections[name] = { description: '', created_at: nowIso() }
          }
          if (!paper.collections.includes(name)) {
            paper.collections = [...paper.collections, name]
            paper.updated_at = nowIso()
          }
          await writeLibrary(lib)
          return { success: true }
        } catch {
          return { success: false }
        }
      })
    },
  )

  ipcMain.handle(
    'library:remove-from-collection',
    async (_event, rawName: unknown, rawId: unknown) => {
      const name = asString(rawName)?.trim()
      const paperId = typeof rawId === 'number' ? rawId : null
      if (!name || paperId == null) return { success: false }
      return await serialized(async () => {
        try {
          const lib = await readLibrary()
          const paper = lib.papers.find((p) => p.id === paperId)
          if (!paper) return { success: false }
          if (paper.collections.includes(name)) {
            paper.collections = paper.collections.filter((c) => c !== name)
            paper.updated_at = nowIso()
            await writeLibrary(lib)
          }
          return { success: true }
        } catch {
          return { success: false }
        }
      })
    },
  )

  ipcMain.handle('library:stats', async () => {
    try {
      const lib = await readLibrary()
      const tagSet = new Set<string>()
      const bySource: Record<string, number> = {}
      const byYear: Record<string, number> = {}
      for (const paper of lib.papers) {
        for (const tag of paper.tags) tagSet.add(tag)
        const source = paper.source ?? 'local'
        bySource[source] = (bySource[source] ?? 0) + 1
        if (paper.year) {
          byYear[paper.year] = (byYear[paper.year] ?? 0) + 1
        }
      }
      return {
        total_papers: lib.papers.length,
        total_tags: tagSet.size,
        tag_count: tagSet.size,
        collection_count: Object.keys(lib.collections).length,
        by_source: bySource,
        by_year: byYear,
      }
    } catch {
      return {
        total_papers: 0,
        total_tags: 0,
        tag_count: 0,
        collection_count: 0,
        by_source: {},
        by_year: {},
      }
    }
  })

  // ── Annotations (P3 v3) ─────────────────────────────────────────

  ipcMain.handle('library:list-annotations', async (_event, rawId: unknown) => {
    const paperId = typeof rawId === 'number' ? rawId : null
    if (paperId == null) return { success: true, annotations: [] }
    try {
      const lib = await readLibrary()
      return {
        success: true,
        annotations: [...(lib.annotations[paperId] ?? [])],
      }
    } catch {
      return { success: true, annotations: [] }
    }
  })

  ipcMain.handle(
    'library:add-annotation',
    async (_event, rawId: unknown, rawBody: unknown) => {
      const paperId = typeof rawId === 'number' ? rawId : null
      if (paperId == null) {
        return { success: false, error: 'Invalid paper id' }
      }
      const body = (rawBody ?? {}) as Record<string, unknown>
      return await serialized(async () => {
        try {
          const lib = await readLibrary()
          const paper = lib.papers.find((p) => p.id === paperId)
          if (!paper) {
            return { success: false, error: `Paper not found: ${paperId}` }
          }
          const id = lib.nextAnnotationId
          const now = nowIso()
          const type = asString(body.type) ?? 'note'
          // Per-type default color so renderer never sees a bogus value
          // when the caller omits `color` (plan §3 — semantic palette).
          // Keep these strings in sync with `src/lib/annotation-colors.ts`.
          const defaultColor =
            type === 'todo'
              ? '#C3BEE0'
              : type === 'underline'
                ? '#9E9E9E'
                : type === 'strike'
                  ? '#7E7E7E'
                  : '#D9C7A7'
          const annotation: StoredAnnotation = {
            id,
            paper_id: paperId,
            page: typeof body.page === 'number' ? body.page : 1,
            type,
            color: asString(body.color) ?? defaultColor,
            content: asString(body.content) ?? '',
            rects: Array.isArray(body.rects)
              ? (body.rects as StoredAnnotation['rects'])
              : [],
            created_at: now,
            updated_at: now,
          }
          // Pass-through optional fields added by the note-taking overhaul.
          // Kept best-effort (ignored if the renderer omits them) — stored
          // verbatim so the round-trip preserves intent across restarts.
          if (typeof body.label === 'string') {
            ;(annotation as StoredAnnotation & { label?: string }).label =
              body.label
          }
          if (Array.isArray(body.tags)) {
            ;(annotation as StoredAnnotation & { tags?: string[] }).tags =
              (body.tags as unknown[])
                .filter((t): t is string => typeof t === 'string' && t.length > 0)
          }
          if (typeof body.todoDone === 'boolean') {
            ;(
              annotation as StoredAnnotation & { todoDone?: boolean }
            ).todoDone = body.todoDone
          }
          if (typeof body.linkedMentionRef === 'string') {
            ;(
              annotation as StoredAnnotation & { linkedMentionRef?: string }
            ).linkedMentionRef = body.linkedMentionRef
          }
          lib.nextAnnotationId = id + 1
          const list = lib.annotations[paperId] ?? []
          lib.annotations[paperId] = [...list, annotation]
          await writeLibrary(lib)
          return { success: true, id, annotation }
        } catch (err) {
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          }
        }
      })
    },
  )

  ipcMain.handle(
    'library:update-annotation',
    async (_event, rawId: unknown, rawPatch: unknown) => {
      const annId = typeof rawId === 'number' ? rawId : null
      if (annId == null) {
        return { success: false, error: 'Invalid annotation id' }
      }
      const patch = (rawPatch ?? {}) as Record<string, unknown>
      return await serialized(async () => {
        try {
          const lib = await readLibrary()
          for (const [paperId, list] of Object.entries(lib.annotations)) {
            const idx = list.findIndex((a) => a.id === annId)
            if (idx < 0) continue
            const current = list[idx]
            const next: StoredAnnotation = {
              ...current,
              page:
                typeof patch.page === 'number' ? patch.page : current.page,
              color:
                'color' in patch
                  ? (asString(patch.color) ?? current.color)
                  : current.color,
              content:
                'content' in patch
                  ? (asString(patch.content) ?? current.content)
                  : current.content,
              rects: Array.isArray(patch.rects)
                ? (patch.rects as StoredAnnotation['rects'])
                : current.rects,
              updated_at: nowIso(),
            }
            const updatedList = [...list]
            updatedList[idx] = next
            lib.annotations[Number(paperId)] = updatedList
            await writeLibrary(lib)
            return { success: true, annotation: next }
          }
          return { success: false, error: `Annotation not found: ${annId}` }
        } catch (err) {
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          }
        }
      })
    },
  )

  ipcMain.handle(
    'library:delete-annotation',
    async (_event, rawId: unknown) => {
      const annId = typeof rawId === 'number' ? rawId : null
      if (annId == null) {
        return { success: false, error: 'Invalid annotation id' }
      }
      return await serialized(async () => {
        try {
          const lib = await readLibrary()
          for (const [paperId, list] of Object.entries(lib.annotations)) {
            const filtered = list.filter((a) => a.id !== annId)
            if (filtered.length === list.length) continue
            lib.annotations[Number(paperId)] = filtered
            await writeLibrary(lib)
            return { success: true }
          }
          return { success: false, error: `Annotation not found: ${annId}` }
        } catch (err) {
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          }
        }
      })
    },
  )

  ipcMain.handle(
    'library:read-pdf-bytes',
    async (_event, rawInput: unknown): Promise<ReadPdfBytesResult> => {
      const input = (rawInput ?? {}) as { id?: unknown }
      try {
        const resolved = await resolveLibraryPdfPath(input.id)
        if (!resolved.ok) {
          return { ok: false, error: resolved.error }
        }
        if (resolved.size > MAX_PDF_BYTES) {
          return {
            ok: false,
            error: `PDF is ${(resolved.size / 1024 / 1024).toFixed(1)} MB, exceeds ${
              MAX_PDF_BYTES / 1024 / 1024
            } MB cap — use the direct viewer URL path instead of byte transport`,
          }
        }
        const buf = await fs.readFile(resolved.path)
        // Transfer a fresh ArrayBuffer (not a Node Buffer view) so Electron's
        // structured clone moves it across the bridge without copying twice.
        const ab = buf.buffer.slice(
          buf.byteOffset,
          buf.byteOffset + buf.byteLength,
        )
        return { ok: true, bytes: ab, size: resolved.size }
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    },
  )

  ipcMain.handle(
    'library:import-pdf',
    async (_event, rawInput: unknown): Promise<ImportPdfResult> => {
      const input = (rawInput ?? {}) as {
        sourcePath?: unknown
        collection?: unknown
        tags?: unknown
      }
      const sourcePath = asString(input.sourcePath)
      if (!sourcePath) {
        return { success: false, error: 'sourcePath is required' }
      }
      try {
        return await importPdfAtPath(sourcePath, {
          collection: asString(input.collection),
          tags: asStringArray(input.tags),
        })
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    },
  )

  // ── Download a PDF from a URL and import it into the library ──────
  //
  // Used by the `literature_fetch` agent tool to acquire open-access PDFs
  // found via OpenAlex / Unpaywall / arXiv. The download happens in the
  // main process (no renderer CSP issues), the file is saved into the
  // app-owned `pdfs/` dir, and a library row is created with the caller-
  // supplied metadata. DOI-based dedup prevents duplicate downloads.

  ipcMain.handle(
    'library:download-and-import-pdf',
    async (
      _event,
      rawInput: unknown,
    ): Promise<ImportPdfResult> => {
      const input = (rawInput ?? {}) as Record<string, unknown>
      const pdfUrl = asString(input.pdfUrl)
      if (!pdfUrl) {
        return { success: false, error: 'pdfUrl is required' }
      }
      if (!pdfUrl.startsWith('https://') && !pdfUrl.startsWith('http://')) {
        return { success: false, error: 'pdfUrl must be an HTTP(S) URL' }
      }

      const title = asString(input.title) || '(untitled)'
      const authors = asString(input.authors) || 'Unknown'
      const year = asString(input.year) || ''
      const doi = asString(input.doi) || ''
      const url = asString(input.url) || ''
      const journal = asString(input.journal) || ''
      const abstract = asString(input.abstract) || ''
      const tags = asStringArray(input.tags)
      const collection = asString(input.collection)

      try {
        return await downloadAndImportPdf(pdfUrl, {
          title,
          authors,
          year,
          doi,
          url,
          journal,
          abstract,
          tags,
          collection,
        })
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    },
  )

  ipcMain.handle(
    'library:refresh-metadata',
    async (): Promise<RefreshMetadataResult> => {
      return serialized(async () => {
        const lib = await readLibrary()
        // Target rows that obviously never got enriched: Unknown author,
        // missing DOI, or DOI still in the mangled "10.xxxx <space> suffix"
        // form from pre-crossref scans. Rows already sourced from crossref
        // are left alone.
        const candidates = lib.papers.filter(
          (p) =>
            p.source !== 'crossref' &&
            (p.authors === 'Unknown' ||
              !p.authors ||
              !p.doi ||
              /\s/.test(p.doi) ||
              !p.year),
        )
        let refreshed = 0
        let skipped = 0
        const errors: { id: number; title: string; msg: string }[] = []

        for (const paper of candidates) {
          // Build DOI candidates from everywhere the DOI might hide:
          //  1. existing `paper.doi` (repaired by normalizeDoi's space fix)
          //  2. the title text (for rows where DOI was pasted into title)
          //  3. the pdf_path basename (most reliable for scan imports)
          const dois = new Set<string>()
          if (paper.doi) dois.add(normalizeDoi(paper.doi))
          if (paper.title) {
            for (const c of extractDoiCandidatesFromStem(paper.title)) dois.add(c)
          }
          if (paper.pdf_path) {
            const base = path
              .basename(paper.pdf_path)
              .replace(/\.pdf$/i, '')
            for (const c of extractDoiCandidatesFromStem(base)) dois.add(c)
          }
          const valid = [...dois].filter((d) => /^10\.\d{4,}\//.test(d))
          const best = pickBestDoiCandidate(valid)
          if (!best) {
            skipped += 1
            continue
          }
          try {
            const meta = await fetchCrossrefByDoi(best)
            if (!meta) {
              // `null` now only means "valid-shaped DOI but Crossref has
              // no record" (or the DOI didn't pass the 10.xxxx/ shape
              // check). That's genuinely a skip — nothing to log.
              skipped += 1
              continue
            }
            paper.title = meta.title
            paper.title_norm = normalizeTitle(meta.title)
            paper.authors = meta.authors
            paper.year = meta.year
            paper.doi = meta.doi
            if (meta.url) paper.url = meta.url
            if (meta.journal) paper.journal = meta.journal
            if (meta.abstract) paper.abstract = meta.abstract
            paper.source = 'crossref'
            paper.updated_at = nowIso()
            refreshed += 1
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            // Log every failure to main-process stderr so a user who sees
            // "0 resolved, 100 errors" can dig into the Electron log to
            // see whether it's a 403, a timeout, a 404, etc. Before this
            // change the handler collapsed all failures into `skipped`
            // with no trace whatsoever.
            // eslint-disable-next-line no-console
            console.warn(
              `[refresh-metadata] id=${paper.id} doi=${best} failed: ${msg}`,
            )
            errors.push({
              id: paper.id,
              title: paper.title,
              msg,
            })
          }
          // Crossref's unauthenticated tier is generous but we're polite —
          // 100 ms between requests keeps large libraries from tripping any
          // rate-limit without meaningfully slowing a refresh of ~50 rows.
          await new Promise((r) => setTimeout(r, 100))
        }

        if (refreshed > 0) await writeLibrary(lib)
        return {
          success: true,
          scanned: candidates.length,
          refreshed,
          skipped,
          errors: errors.length > 0 ? errors : undefined,
        }
      })
    },
  )

  ipcMain.handle(
    'library:scan-directory',
    async (_event, rawInput: unknown): Promise<ScanDirectoryResult> => {
      const input = (rawInput ?? {}) as {
        directory?: unknown
        collection?: unknown
        tags?: unknown
      }
      const directory = asString(input.directory)
      if (!directory) {
        return { success: false, error: 'directory is required' }
      }
      try {
        const { pdfs, subdirErrors } = await walkPdfs(directory)
        if (pdfs.length === 0) {
          return {
            success: true,
            scanned: 0,
            added: 0,
            // Empty-but-success is a common surprise ("why did nothing
            // import?") — include the subdir errors when present so the
            // UI can explain it ("2 of your subdirs were unreadable").
            errors: subdirErrors.length > 0 ? subdirErrors : undefined,
          }
        }
        const collection = asString(input.collection)
        const tags = asStringArray(input.tags)
        let added = 0
        const errors: string[] = []
        // Sequential (not Promise.all) because `importPdfAtPath` goes
        // through the write-mutex — in parallel they'd all wait for each
        // other anyway, and sequencing makes progress easier to reason
        // about + keeps memory flat on huge trees.
        for (const pdfPath of pdfs) {
          const result = await importPdfAtPath(pdfPath, { collection, tags })
          if (result.success) {
            added += 1
          } else {
            errors.push(`${path.basename(pdfPath)}: ${result.error}`)
          }
        }
        return {
          success: true,
          scanned: pdfs.length,
          added,
          errors:
            errors.length > 0 || subdirErrors.length > 0
              ? [...errors, ...subdirErrors]
              : undefined,
        }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    },
  )
}

// ── PDF ingestion ─────────────────────────────────────────────────────

type ImportPdfResult =
  | { success: true; id: number; pdfPath: string; deduped: boolean }
  | { success: false; error: string }

type ScanDirectoryResult =
  | {
      success: true
      /** Count of .pdf files discovered under the root (before import). */
      scanned: number
      /** Count successfully added to the library. */
      added: number
      /** Per-file import failures + unreadable subdir notices. Undefined
       *  when everything succeeded. */
      errors?: string[]
    }
  | { success: false; error: string }

type RefreshMetadataResult =
  | {
      success: true
      /** Rows identified as needing refresh (Unknown author, missing / spaced DOI, …). */
      scanned: number
      /** Rows whose metadata was successfully overwritten from Crossref. */
      refreshed: number
      /** Rows skipped because no DOI candidate resolvable (or Crossref 404). */
      skipped: number
      errors?: { id: number; title: string; msg: string }[]
    }
  | { success: false; error: string }

type ReadPdfBytesResult =
  | { ok: true; bytes: ArrayBuffer; size: number }
  | { ok: false; error: string }

export type ResolveLibraryPdfResult =
  | { ok: true; path: string; size: number }
  | { ok: false; error: string; status?: number }

/**
 * Upper bound for the blob-URL PDF read path. 50 MB covers every normal
 * research paper (typical: 2-10 MB); anything bigger should graduate to
 * the streaming custom-protocol path described in the plan doc.
 */
const MAX_PDF_BYTES = 50 * 1024 * 1024

function pdfStoreDir(): string {
  return path.join(libraryDir(), 'pdfs')
}

export async function resolveLibraryPdfPath(
  rawId: unknown,
): Promise<ResolveLibraryPdfResult> {
  const id =
    typeof rawId === 'number'
      ? rawId
      : typeof rawId === 'string'
        ? Number(rawId)
        : NaN
  if (!Number.isFinite(id)) {
    return { ok: false, error: 'id must be a number', status: 400 }
  }
  try {
    const lib = await readLibrary()
    const paper = lib.papers.find((p) => p.id === id)
    if (!paper) return { ok: false, error: `paper ${id} not found`, status: 404 }
    const pdfPath = paper.pdf_path?.trim()
    if (!pdfPath) {
      return { ok: false, error: `paper ${id} has no pdf_path`, status: 404 }
    }
    const allowedRoot = pdfStoreDir()
    const resolved = path.resolve(pdfPath)
    const rootResolved = path.resolve(allowedRoot)
    if (!resolved.startsWith(rootResolved + path.sep) && resolved !== rootResolved) {
      return {
        ok: false,
        error: 'pdf_path is outside the managed library dir',
        status: 403,
      }
    }
    let stats
    try {
      stats = await fs.stat(resolved)
    } catch (err) {
      return {
        ok: false,
        error: `cannot stat pdf (${
          err instanceof Error ? err.message : String(err)
        })`,
        status: 404,
      }
    }
    if (!stats.isFile()) {
      return { ok: false, error: 'pdf_path is not a regular file', status: 404 }
    }
    return { ok: true, path: resolved, size: stats.size }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      status: 500,
    }
  }
}

/**
 * Take a PDF at `sourcePath`, copy it into the app-owned storage dir, and
 * add a library row pointing at the copied file. Idempotent on normalised
 * title: if a paper with the same title already exists we attach the PDF
 * path to it (without touching other fields) rather than creating a
 * duplicate row.
 *
 * Title defaults to the file basename sans `.pdf` unless the stem embeds a
 * DOI — then we resolve metadata via Crossref (no Python worker required).
 */
async function importPdfAtPath(
  sourcePath: string,
  opts: { collection?: string; tags: string[] },
): Promise<ImportPdfResult> {
  let sourceStats
  try {
    sourceStats = await fs.stat(sourcePath)
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : `cannot stat ${sourcePath}`,
    }
  }
  if (!sourceStats.isFile()) {
    return { success: false, error: `not a regular file: ${sourcePath}` }
  }
  const basename = path.basename(sourcePath)
  if (!/\.pdf$/i.test(basename)) {
    return { success: false, error: `not a PDF (by extension): ${basename}` }
  }

  const stem = basename.replace(/\.pdf$/i, '')
  const fallbackTitle = stem.replace(/[_-]+/g, ' ').trim()
  if (!fallbackTitle) {
    return { success: false, error: `PDF has empty title: ${sourcePath}` }
  }

  const crossref = await resolvePdfStemViaCrossref(stem)
  const titleGuess = crossref?.title?.trim() || fallbackTitle
  const authorsGuess = crossref?.authors?.trim() || 'Unknown'
  const yearGuess = crossref?.year?.trim() || ''
  const doiGuess = crossref?.doi?.trim()
  const urlGuess = crossref?.url?.trim()
  const journalGuess = crossref?.journal?.trim()
  const abstractGuess = crossref?.abstract?.trim()
  const sourceGuess: string = crossref ? 'crossref' : 'upload'

  return await serialized(async () => {
    try {
      await fs.mkdir(pdfStoreDir(), { recursive: true })
      const lib = await readLibrary()

      if (doiGuess) {
        const dkey = libraryDoiKey(doiGuess)
        const existingDoi = lib.papers.find(
          (p) => p.doi && libraryDoiKey(p.doi) === dkey,
        )
        if (existingDoi) {
          if (existingDoi.pdf_path) {
            return {
              success: true,
              id: existingDoi.id,
              pdfPath: existingDoi.pdf_path,
              deduped: true,
            }
          }
          const destPath = path.join(pdfStoreDir(), `${existingDoi.id}.pdf`)
          await fs.copyFile(sourcePath, destPath)
          existingDoi.pdf_path = destPath
          existingDoi.updated_at = nowIso()
          await writeLibrary(lib)
          return {
            success: true,
            id: existingDoi.id,
            pdfPath: destPath,
            deduped: true,
          }
        }
      }

      const norm = normalizeTitle(titleGuess)
      const existing = lib.papers.find((p) => p.title_norm === norm)
      if (existing) {
        // Already in the library — if it doesn't have a PDF yet, attach
        // this one so the viewer has something to open.
        if (existing.pdf_path) {
          return {
            success: true,
            id: existing.id,
            pdfPath: existing.pdf_path,
            deduped: true,
          }
        }
        const destPath = path.join(pdfStoreDir(), `${existing.id}.pdf`)
        await fs.copyFile(sourcePath, destPath)
        existing.pdf_path = destPath
        existing.updated_at = nowIso()
        if (doiGuess && !existing.doi) existing.doi = doiGuess
        if (urlGuess && !existing.url) existing.url = urlGuess
        if (journalGuess && !existing.journal) existing.journal = journalGuess
        if (abstractGuess && !existing.abstract) existing.abstract = abstractGuess
        if (authorsGuess !== 'Unknown' && existing.authors === 'Unknown') {
          existing.authors = authorsGuess
        }
        if (yearGuess && !existing.year) existing.year = yearGuess
        await writeLibrary(lib)
        return { success: true, id: existing.id, pdfPath: destPath, deduped: true }
      }

      const id = lib.nextId
      const destPath = path.join(pdfStoreDir(), `${id}.pdf`)
      await fs.copyFile(sourcePath, destPath)
      const created = nowIso()
      const paper: StoredLibraryPaper = {
        id,
        title: titleGuess,
        title_norm: norm,
        authors: authorsGuess,
        year: yearGuess,
        doi: doiGuess,
        url: urlGuess,
        journal: journalGuess,
        abstract: abstractGuess,
        source: sourceGuess,
        pdf_path: destPath,
        tags: opts.tags,
        collections: opts.collection ? [opts.collection] : [],
        created_at: created,
        updated_at: created,
      }
      lib.papers.push(paper)
      lib.nextId = id + 1
      await writeLibrary(lib)
      return { success: true, id, pdfPath: destPath, deduped: false }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  })
}

interface DownloadAndImportOpts {
  title: string
  authors: string
  year: string
  doi: string
  url: string
  journal: string
  abstract: string
  tags: string[]
  collection?: string
}

const DOWNLOAD_TIMEOUT_MS = 30_000

async function downloadAndImportPdf(
  pdfUrl: string,
  opts: DownloadAndImportOpts,
): Promise<ImportPdfResult> {
  return await serialized(async () => {
    const lib = await readLibrary()

    if (opts.doi) {
      const dkey = libraryDoiKey(opts.doi)
      const existing = lib.papers.find(
        (p) => p.doi && libraryDoiKey(p.doi) === dkey,
      )
      if (existing?.pdf_path) {
        return {
          success: true,
          id: existing.id,
          pdfPath: existing.pdf_path,
          deduped: true,
        }
      }
      if (existing) {
        const destPath = path.join(pdfStoreDir(), `${existing.id}.pdf`)
        await downloadToFile(pdfUrl, destPath)
        existing.pdf_path = destPath
        existing.updated_at = nowIso()
        await writeLibrary(lib)
        return {
          success: true,
          id: existing.id,
          pdfPath: destPath,
          deduped: true,
        }
      }
    }

    const norm = normalizeTitle(opts.title)
    const existing = lib.papers.find((p) => p.title_norm === norm)
    if (existing?.pdf_path) {
      return {
        success: true,
        id: existing.id,
        pdfPath: existing.pdf_path,
        deduped: true,
      }
    }
    if (existing) {
      const destPath = path.join(pdfStoreDir(), `${existing.id}.pdf`)
      await downloadToFile(pdfUrl, destPath)
      existing.pdf_path = destPath
      existing.updated_at = nowIso()
      await writeLibrary(lib)
      return {
        success: true,
        id: existing.id,
        pdfPath: destPath,
        deduped: true,
      }
    }

    await fs.mkdir(pdfStoreDir(), { recursive: true })
    const id = lib.nextId
    const destPath = path.join(pdfStoreDir(), `${id}.pdf`)
    await downloadToFile(pdfUrl, destPath)

    const created = nowIso()
    const paper: StoredLibraryPaper = {
      id,
      title: opts.title,
      title_norm: norm,
      authors: opts.authors,
      year: opts.year,
      doi: opts.doi || undefined,
      url: opts.url || undefined,
      journal: opts.journal || undefined,
      abstract: opts.abstract || undefined,
      source: 'auto-fetch',
      pdf_path: destPath,
      tags: opts.tags.length > 0 ? opts.tags : ['auto-fetch'],
      collections: opts.collection ? [opts.collection] : [],
      created_at: created,
      updated_at: created,
    }
    lib.papers.push(paper)
    lib.nextId = id + 1
    await writeLibrary(lib)
    return { success: true, id, pdfPath: destPath, deduped: false }
  })
}

async function downloadToFile(
  url: string,
  destPath: string,
): Promise<void> {
  const resp = await net.fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    headers: {
      'user-agent': 'Lattice-app/1.0 (literature-fetch)',
      accept: 'application/pdf,*/*',
    },
  })
  if (!resp.ok) {
    throw new Error(`PDF download failed: HTTP ${resp.status} from ${url}`)
  }
  const buf = Buffer.from(await resp.arrayBuffer())
  if (buf.length < 5) {
    throw new Error('Downloaded file is empty or too small')
  }
  if (buf.length > MAX_PDF_BYTES) {
    throw new Error(
      `Downloaded file exceeds ${MAX_PDF_BYTES / (1024 * 1024)} MB limit`,
    )
  }
  const header = buf.subarray(0, 5).toString('ascii')
  if (!header.startsWith('%PDF-')) {
    throw new Error(
      `Downloaded file does not appear to be a PDF (header: ${header})`,
    )
  }
  await fs.mkdir(path.dirname(destPath), { recursive: true })
  await fs.writeFile(destPath, buf)
}

/**
 * Recursively collect every `.pdf` under `root` (depth-capped so a pathological
 * symlinked tree can't spin forever). Hidden dot-dirs / `node_modules` /
 * `.git` are skipped — these never contain user papers.
 *
 * The root directory's readdir error is NOT swallowed — if the user typed a
 * path that doesn't exist or can't be read, we surface the reason so the UI
 * can show it, rather than reporting "0 PDFs found" which is how this bug
 * manifested in testing. Subdirectory read errors are collected into
 * `subdirErrors` so the caller can decide whether to surface them (at the
 * moment the IPC handler drops them because a handful of unreadable nested
 * dirs shouldn't poison an otherwise-successful scan).
 */
async function walkPdfs(
  root: string,
): Promise<{ pdfs: string[]; subdirErrors: string[] }> {
  const MAX_DEPTH = 8
  const SKIP_DIRS = new Set(['node_modules', '.git', 'venv', '.venv', '__pycache__'])
  const pdfs: string[] = []
  const subdirErrors: string[] = []

  // Validate the root before walking so "no such file" / "permission denied"
  // produces a clear error instead of a silent empty list.
  let rootStats
  try {
    rootStats = await fs.stat(root)
  } catch (err) {
    throw new Error(
      `cannot access ${root}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  if (!rootStats.isDirectory()) {
    throw new Error(`not a directory: ${root}`)
  }

  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]
  while (stack.length > 0) {
    const frame = stack.pop()
    if (!frame) break
    const { dir, depth } = frame
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch (err) {
      if (dir === root) {
        // Shouldn't happen given the stat above, but surface it loudly if
        // it does (e.g. TOCTOU race or permission revoked mid-scan).
        throw err
      }
      subdirErrors.push(
        `${dir}: ${err instanceof Error ? err.message : String(err)}`,
      )
      continue
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (depth + 1 > MAX_DEPTH) continue
        if (SKIP_DIRS.has(entry.name)) continue
        stack.push({ dir: full, depth: depth + 1 })
        continue
      }
      if (entry.isFile() && /\.pdf$/i.test(entry.name)) {
        pdfs.push(full)
      }
    }
  }
  return { pdfs, subdirErrors }
}
