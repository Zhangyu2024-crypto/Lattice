import { describe, it, expect, afterEach } from 'vitest'
import { idbGet, idbSet, idbRemove, __resetIdbStorage } from './idb-storage'

const hasIdb = typeof globalThis.indexedDB !== 'undefined'

afterEach(() => {
  __resetIdbStorage()
})

describe('idb-storage (guarded)', () => {
  it('returns null from idbGet when indexedDB is unavailable', async () => {
    if (hasIdb) return // cannot simulate the missing-IDB path here without
    // mutating the global — the real case is node env; skip.
    expect(await idbGet('missing-key')).toBeNull()
  })

  if (hasIdb) {
    it('round-trips a value', async () => {
      const key = `test-${Date.now()}-rt`
      await idbSet(key, 'hello world')
      expect(await idbGet(key)).toBe('hello world')
      await idbRemove(key)
      expect(await idbGet(key)).toBeNull()
    })

    it('overwrites an existing value', async () => {
      const key = `test-${Date.now()}-ow`
      await idbSet(key, 'first')
      await idbSet(key, 'second')
      expect(await idbGet(key)).toBe('second')
      await idbRemove(key)
    })
  }
})
