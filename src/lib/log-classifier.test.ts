import { describe, expect, it } from 'vitest'
import { classifyError, pathToSource, statusToType, truncate } from './log-classifier'

describe('statusToType', () => {
  it('401/403 → permission', () => {
    expect(statusToType(401)).toBe('permission')
    expect(statusToType(403)).toBe('permission')
  })
  it('404 → not_found', () => {
    expect(statusToType(404)).toBe('not_found')
  })
  it('408/504 → timeout', () => {
    expect(statusToType(408)).toBe('timeout')
    expect(statusToType(504)).toBe('timeout')
  })
  it('5xx → http', () => {
    expect(statusToType(500)).toBe('http')
    expect(statusToType(502)).toBe('http')
  })
  it('other 4xx → http', () => {
    expect(statusToType(400)).toBe('http')
    expect(statusToType(429)).toBe('http')
  })
  it('2xx → runtime (unusual, but stable)', () => {
    expect(statusToType(200)).toBe('runtime')
  })
})

describe('pathToSource', () => {
  it('recognises /api/knowledge', () => {
    expect(pathToSource('/api/knowledge/search')).toBe('knowledge')
    expect(pathToSource('http://localhost/api/knowledge/stats')).toBe('knowledge')
  })
  it('recognises /api/library', () => {
    expect(pathToSource('/api/library/papers')).toBe('library')
  })
  it('recognises /api/pro', () => {
    expect(pathToSource('/api/pro/run')).toBe('pro')
  })
  it('unknown path → ipc', () => {
    expect(pathToSource('/nowhere')).toBe('ipc')
    expect(pathToSource('')).toBe('ipc')
  })
})

describe('classifyError', () => {
  it('custom API error with status → statusToType', () => {
    const err = Object.assign(new Error('not found'), { status: 404 })
    expect(classifyError(err)).toBe('not_found')
  })
  it('AbortError name → abort', () => {
    const err = Object.assign(new Error('cancelled'), { name: 'AbortError' })
    expect(classifyError(err)).toBe('abort')
  })
  it('SyntaxError → parse', () => {
    expect(classifyError(new SyntaxError('bad json'))).toBe('parse')
  })
  it('timeout message → timeout', () => {
    expect(classifyError(new Error('Request timed out after 5s'))).toBe('timeout')
  })
  it('network pattern → network', () => {
    expect(classifyError(new Error('fetch failed'))).toBe('network')
    expect(classifyError(new Error('ECONNREFUSED'))).toBe('network')
  })
  it('permission pattern → permission', () => {
    expect(classifyError(new Error('access denied'))).toBe('permission')
  })
  it('unknown → runtime', () => {
    expect(classifyError(new Error('boom'))).toBe('runtime')
    expect(classifyError('plain string')).toBe('runtime')
  })
})

describe('truncate', () => {
  it('short input unchanged', () => {
    expect(truncate('hello', 10)).toBe('hello')
  })
  it('long input suffixed with count', () => {
    const s = 'a'.repeat(20)
    const out = truncate(s, 5)
    expect(out?.startsWith('aaaaa')).toBe(true)
    expect(out).toContain('[+15 chars]')
  })
  it('undefined → undefined', () => {
    expect(truncate(undefined, 5)).toBeUndefined()
  })
})
