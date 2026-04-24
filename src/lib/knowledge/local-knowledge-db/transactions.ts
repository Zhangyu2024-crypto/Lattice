// Thin promise wrappers over IDB transactions. These preserve the exact
// request/transaction semantics of the original inline helpers:
//   - `tx(...)` returns the single-IDBRequest result; non-request callbacks
//     go unresolved by design (callers in this module only use it for
//     getAll / index.getAll requests).
//   - `put` / `del` resolve on `oncomplete` to guarantee the write is
//     durable before awaiting callers proceed.

import { openDb } from './schema'

export async function tx<T>(
  storeNames: string | string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => IDBRequest | Promise<T>,
): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeNames, mode)
    const result = fn(transaction)
    if (result instanceof IDBRequest) {
      result.onsuccess = () => resolve(result.result as T)
      result.onerror = () => reject(result.error)
    }
    transaction.onerror = () => reject(transaction.error)
  })
}

export async function getAll<T>(storeName: string): Promise<T[]> {
  return tx(storeName, 'readonly', (t) =>
    t.objectStore(storeName).getAll(),
  )
}

export async function getAllByIndex<T>(
  storeName: string,
  indexName: string,
  key: IDBValidKey,
): Promise<T[]> {
  return tx(storeName, 'readonly', (t) =>
    t.objectStore(storeName).index(indexName).getAll(key),
  )
}

export async function put<T>(storeName: string, value: T): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, 'readwrite')
    t.objectStore(storeName).put(value)
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
  })
}

export async function del(storeName: string, key: IDBValidKey): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, 'readwrite')
    t.objectStore(storeName).delete(key)
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
  })
}
