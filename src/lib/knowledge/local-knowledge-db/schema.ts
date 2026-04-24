// IndexedDB schema definition and database opener.
// Version history is encoded entirely in `onupgradeneeded` — bump
// `DB_VERSION` and extend the upgrade handler when adding stores or
// indexes (the existing `if (!db.objectStoreNames.contains(...))` guards
// make the handler idempotent across upgrades).
//
// v2 (2026-04): tag every existing chain with `extractor_version =
// 'v1-legacy'` + `quality = 'legacy'` so the new read-path default
// (accepted-only) naturally hides pre-gate data without destructive
// deletion. Users can still opt back in via a "Show legacy" toggle.

import { LEGACY_EXTRACTOR_VERSION } from '../extractor-version'

export const DB_NAME = 'lattice-knowledge'
export const DB_VERSION = 2

let dbPromise: Promise<IDBDatabase> | null = null

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (event) => {
      const db = req.result
      const upgradeTx = req.transaction
      const oldVersion = event.oldVersion ?? 0

      if (!db.objectStoreNames.contains('extractions')) {
        const store = db.createObjectStore('extractions', { keyPath: 'id' })
        store.createIndex('paper_id', 'paper_id', { unique: false })
        store.createIndex('extracted_at', 'extracted_at', { unique: false })
      }
      if (!db.objectStoreNames.contains('chains')) {
        const store = db.createObjectStore('chains', { keyPath: 'id' })
        store.createIndex('extraction_id', 'extraction_id', { unique: false })
      }
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' })
      }

      // v1 → v2: backfill extractor_version + quality on existing chains.
      // Runs inside the versionchange transaction so it completes before
      // any app-level transaction opens the DB.
      if (oldVersion >= 1 && oldVersion < 2 && upgradeTx) {
        const chainStore = upgradeTx.objectStore('chains')
        const cursorReq = chainStore.openCursor()
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result
          if (!cursor) return
          const value = cursor.value as Record<string, unknown>
          let changed = false
          if (!value.extractor_version) {
            value.extractor_version = LEGACY_EXTRACTOR_VERSION
            changed = true
          }
          if (!value.quality) {
            value.quality = 'legacy'
            changed = true
          }
          if (changed) cursor.update(value)
          cursor.continue()
        }
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}
