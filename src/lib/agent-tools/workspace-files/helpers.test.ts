import { describe, expect, it } from 'vitest'
import { matchesGlob } from './helpers'

describe('matchesGlob', () => {
  it('matches root-level files with **/ prefix', () => {
    // Regression: `**/*.raw` previously required at least one `/`,
    // so root-level files like `RT-Quarzt.raw` were silently dropped.
    expect(matchesGlob('RT-Quarzt.raw', '**/*.raw')).toBe(true)
  })

  it('matches nested files with **/ prefix', () => {
    expect(matchesGlob('refinement/NM0.8T1.2P.raw', '**/*.raw')).toBe(true)
    expect(matchesGlob('a/b/c/foo.raw', '**/*.raw')).toBe(true)
  })

  it('matches a fixed name across any depth (including zero)', () => {
    expect(matchesGlob('foo.raw', '**/foo.raw')).toBe(true)
    expect(matchesGlob('dir/foo.raw', '**/foo.raw')).toBe(true)
    expect(matchesGlob('a/b/foo.raw', '**/foo.raw')).toBe(true)
  })

  it('matches **/ in the middle (zero or more intermediate dirs)', () => {
    expect(matchesGlob('a/b.raw', 'a/**/b.raw')).toBe(true)
    expect(matchesGlob('a/x/b.raw', 'a/**/b.raw')).toBe(true)
    expect(matchesGlob('a/x/y/b.raw', 'a/**/b.raw')).toBe(true)
  })

  it('keeps single-* limited to a single segment', () => {
    expect(matchesGlob('foo.raw', '*.raw')).toBe(true)
    expect(matchesGlob('dir/foo.raw', '*.raw')).toBe(false)
    expect(matchesGlob('data/foo.json', 'data/*.json')).toBe(true)
    expect(matchesGlob('data/sub/foo.json', 'data/*.json')).toBe(false)
  })

  it('honors literal directory anchors', () => {
    expect(matchesGlob('refinement/foo.raw', 'refinement/*.raw')).toBe(true)
    expect(matchesGlob('other/foo.raw', 'refinement/*.raw')).toBe(false)
  })

  it('respects ? as a single non-slash character', () => {
    expect(matchesGlob('a.raw', '?.raw')).toBe(true)
    expect(matchesGlob('ab.raw', '?.raw')).toBe(false)
    expect(matchesGlob('a/b.raw', 'a/?.raw')).toBe(true)
  })

  it('escapes regex metacharacters in the pattern', () => {
    expect(matchesGlob('a.b.raw', 'a.b.raw')).toBe(true)
    expect(matchesGlob('axb.raw', 'a.b.raw')).toBe(false)
  })
})
