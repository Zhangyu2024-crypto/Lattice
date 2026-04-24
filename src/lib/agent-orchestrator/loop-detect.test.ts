import { describe, expect, it } from 'vitest'
import type { ToolCallRequest } from '../../types/agent-tool'
import { isStuckLoop, iterationSignature } from './loop-detect'

const call = (
  id: string,
  name: string,
  input: Record<string, unknown>,
): ToolCallRequest => ({ id, name, input })

describe('iterationSignature', () => {
  it('collapses parallel-call ordering to the same signature', () => {
    const a = iterationSignature([
      call('1', 'grep', { pattern: 'foo' }),
      call('2', 'read', { path: '/tmp/a' }),
    ])
    const b = iterationSignature([
      call('2', 'read', { path: '/tmp/a' }),
      call('1', 'grep', { pattern: 'foo' }),
    ])
    expect(a).toBe(b)
  })

  it('sorts object keys so argument-order does not matter', () => {
    const a = iterationSignature([call('1', 'grep', { a: 1, b: 2 })])
    const b = iterationSignature([call('1', 'grep', { b: 2, a: 1 })])
    expect(a).toBe(b)
  })

  it('distinguishes different argument values', () => {
    const a = iterationSignature([call('1', 'grep', { pattern: 'foo' })])
    const b = iterationSignature([call('1', 'grep', { pattern: 'bar' })])
    expect(a).not.toBe(b)
  })
})

describe('isStuckLoop', () => {
  it('flags three identical signatures in a row', () => {
    expect(isStuckLoop(['a', 'a', 'a'], 3)).toBe(true)
  })

  it('does not flag a mixed history of equal length', () => {
    expect(isStuckLoop(['a', 'b', 'a'], 3)).toBe(false)
  })

  it('only looks at the tail — older duplicates do not count', () => {
    expect(isStuckLoop(['a', 'a', 'a', 'b'], 3)).toBe(false)
  })

  it('requires at least `window` entries', () => {
    expect(isStuckLoop(['a', 'a'], 3)).toBe(false)
  })
})
