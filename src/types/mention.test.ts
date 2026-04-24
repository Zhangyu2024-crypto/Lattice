// @vitest-environment node
//
// Tier 1 · unit tests for the mention-anchor helper. The contract the rest
// of the app depends on is (a) format (5 chars, 0-9/a-z) and (b) collision-
// free output even under thousands of existing anchors in the same message.

import { describe, it, expect } from 'vitest'
import { generateMentionAnchor } from './mention'

describe('generateMentionAnchor', () => {
  it('produces a 5-character base-36 token on an empty set', () => {
    const a = generateMentionAnchor(new Set())
    expect(a).toMatch(/^[0-9a-z]{5}$/)
  })

  it('never returns an anchor that exists in the provided set', () => {
    // Pre-fill a dense set and verify 1000 draws all dodge it.
    const taken = new Set<string>()
    for (let i = 0; i < 5000; i++) {
      const a = generateMentionAnchor(taken)
      expect(taken.has(a)).toBe(false)
      taken.add(a)
    }
    expect(taken.size).toBe(5000)
  })

  it('throws when the anchor alphabet is exhausted', () => {
    // 36^5 is 60_466_176 — constructing a Set that large in a test is
    // impractical, so we just verify the guard path by stubbing size.
    const bogus: Set<string> = new Set()
    Object.defineProperty(bogus, 'size', { value: 36 ** 5 })
    expect(() => generateMentionAnchor(bogus)).toThrow(/exhausted/)
  })
})
