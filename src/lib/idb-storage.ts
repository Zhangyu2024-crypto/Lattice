// Tiny native-IndexedDB key-value wrapper — used as an overflow store for
// the runtime-store when a session blob outgrows localStorage's ~5 MB cap.
// Zero-dep, Promise-based, no-ops cleanly when `indexedDB` is unavailable
// (e.g. jsdom without a polyfill) so imports never throw at module load.

const DB_NAME = 'lattice-runtime-kv'
const DB_VERSION = 1
const STORE_NAME = 'kv'

let dbPromise: Promise<IDBDatabase> | null = null

function hasIndexedDb(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as { indexedDB?: unknown }).indexedDB !== 'undefined'
  )
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  if (!hasIndexedDb()) {
    dbPromise = Promise.reject(new Error('indexedDB is not available'))
    return dbPromise
  }
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'))
  })
  return dbPromise
}

function runRequest<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode)
        const store = tx.objectStore(STORE_NAME)
        const req = fn(store)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () =>
          reject(req.error ?? new Error('indexedDB request failed'))
      }),
  )
}

/** Read a string value by key. Returns null when the key is absent or
 *  IDB is unavailable. Never throws. */
export async function idbGet(key: string): Promise<string | null> {
  if (!hasIndexedDb()) return null
  try {
    const value = await runRequest<unknown>('readonly', (s) => s.get(key))
    return typeof value === 'string' ? value : null
  } catch {
    return null
  }
}

/** Store a string value under `key`. Rejects on quota / disk errors so
 *  callers can surface them — the overflow fallback relies on this to
 *  know whether to keep retrying or surface an error to the user. */
export async function idbSet(key: string, value: string): Promise<void> {
  if (!hasIndexedDb()) {
    throw new Error('indexedDB is not available')
  }
  await runRequest<IDBValidKey>('readwrite', (s) => s.put(value, key))
}

/** Remove a stored value. No-op if the key is absent or IDB is
 *  unavailable; mirrors `Storage.removeItem` which never throws. */
export async function idbRemove(key: string): Promise<void> {
  if (!hasIndexedDb()) return
  try {
    await runRequest<undefined>('readwrite', (s) => s.delete(key))
  } catch {
    // best-effort delete
  }
}

/** Testing helper — drops the cached DB handle so subsequent calls
 *  re-open (needed after test teardown / schema changes). */
export function __resetIdbStorage(): void {
  dbPromise = null
}
