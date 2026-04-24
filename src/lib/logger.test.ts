import { beforeEach, describe, expect, it } from 'vitest'
import { useLogStore } from '../stores/log-store'
import { log, logWorkerFailure } from './logger'

describe('logger', () => {
  beforeEach(() => {
    useLogStore.setState({ entries: [], unreadCount: 0 })
  })

  it('log.error produces an entry with source/type/detail', () => {
    log.error('boom', {
      source: 'library',
      type: 'http',
      detail: { httpStatus: 500 },
    })
    const entries = useLogStore.getState().entries
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      level: 'error',
      source: 'library',
      type: 'http',
      message: 'boom',
    })
    expect(entries[0].detail?.httpStatus).toBe(500)
  })

  it('log.exception extracts stack + auto-classifies type', () => {
    const err = Object.assign(new Error('Request timed out after 5s'), {
      code: 'ETIMEDOUT',
    })
    log.exception(err, { source: 'worker' })
    const [entry] = useLogStore.getState().entries
    expect(entry.type).toBe('timeout')
    expect(entry.message).toBe('Request timed out after 5s')
    expect(entry.detail?.stack).toBeDefined()
    expect(entry.detail?.code).toBe('ETIMEDOUT')
  })

  it('log.exception picks up status off custom error classes', () => {
    const err = Object.assign(new Error('not found'), { status: 404 })
    log.exception(err, { source: 'library' })
    const [entry] = useLogStore.getState().entries
    expect(entry.type).toBe('not_found')
    expect(entry.detail?.httpStatus).toBe(404)
  })

  it('log.info defaults type to unknown', () => {
    log.info('hello', { source: 'ui' })
    const [entry] = useLogStore.getState().entries
    expect(entry.level).toBe('info')
    expect(entry.type).toBe('unknown')
  })

  it('logWorkerFailure maps TIMEOUT → timeout', () => {
    logWorkerFailure('xrd.search', { ok: false, error: 'timed out', code: 'TIMEOUT', duration_ms: 2000 })
    const [entry] = useLogStore.getState().entries
    expect(entry.source).toBe('worker')
    expect(entry.type).toBe('timeout')
    expect(entry.detail?.method).toBe('xrd.search')
    expect(entry.detail?.durationMs).toBe(2000)
  })

  it('logWorkerFailure maps UNKNOWN_METHOD → not_found', () => {
    logWorkerFailure('nope.method', { ok: false, error: "no such tool", code: 'UNKNOWN_METHOD' })
    const [entry] = useLogStore.getState().entries
    expect(entry.type).toBe('not_found')
  })
})
