import type { DbCollection, DbEntry, DbEntryId } from '../types/artifact-db'

const DB_NAME = 'lattice-artifact-db'
const DB_VERSION = 1
const ENTRIES_STORE = 'entries'
const META_STORE = 'meta'
const META_KEY = 'db-meta'

let dbPromise: Promise<IDBDatabase> | null = null

function hasIdb(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as { indexedDB?: unknown }).indexedDB !== 'undefined'
  )
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  if (!hasIdb()) {
    dbPromise = Promise.reject(new Error('indexedDB unavailable'))
    return dbPromise
  }
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(ENTRIES_STORE)) {
        const store = db.createObjectStore(ENTRIES_STORE, { keyPath: 'id' })
        store.createIndex('kind', 'sourceArtifactKind', { unique: false })
        store.createIndex('createdAt', 'createdAt', { unique: false })
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IDB open failed'))
  })
  return dbPromise
}

function run<T>(
  stores: string | string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(stores, mode)
        const req = fn(tx)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error ?? new Error('IDB request failed'))
      }),
  )
}

export async function dbIdbGetEntry(id: DbEntryId): Promise<DbEntry | null> {
  if (!hasIdb()) return null
  try {
    const val = await run<DbEntry | undefined>(ENTRIES_STORE, 'readonly', (tx) =>
      tx.objectStore(ENTRIES_STORE).get(id),
    )
    return val ?? null
  } catch {
    return null
  }
}

export async function dbIdbPutEntry(entry: DbEntry): Promise<void> {
  if (!hasIdb()) throw new Error('indexedDB unavailable')
  await run<IDBValidKey>(ENTRIES_STORE, 'readwrite', (tx) =>
    tx.objectStore(ENTRIES_STORE).put(entry),
  )
}

export async function dbIdbDeleteEntry(id: DbEntryId): Promise<void> {
  if (!hasIdb()) return
  try {
    await run<undefined>(ENTRIES_STORE, 'readwrite', (tx) =>
      tx.objectStore(ENTRIES_STORE).delete(id),
    )
  } catch {
    // best-effort
  }
}

export async function dbIdbGetAllEntries(): Promise<DbEntry[]> {
  if (!hasIdb()) return []
  try {
    const all = await run<DbEntry[]>(ENTRIES_STORE, 'readonly', (tx) =>
      tx.objectStore(ENTRIES_STORE).getAll(),
    )
    return all ?? []
  } catch {
    return []
  }
}

interface DbMeta {
  collections: DbCollection[]
  globalTags: string[]
}

export async function dbIdbGetMeta(): Promise<DbMeta | null> {
  if (!hasIdb()) return null
  try {
    const val = await run<DbMeta | undefined>(META_STORE, 'readonly', (tx) =>
      tx.objectStore(META_STORE).get(META_KEY),
    )
    return val ?? null
  } catch {
    return null
  }
}

export async function dbIdbPutMeta(meta: DbMeta): Promise<void> {
  if (!hasIdb()) return
  try {
    await run<IDBValidKey>(META_STORE, 'readwrite', (tx) =>
      tx.objectStore(META_STORE).put(meta, META_KEY),
    )
  } catch {
    // best-effort
  }
}

export function __resetDbIdb(): void {
  dbPromise = null
}
