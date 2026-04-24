// Tier 1 · unit test for `slugForCifKey`.
//
// This slug is the bridge between the structure artifact layer and the
// Python env variable `ACTIVE_CIFS`. Templates call
// `load_structure('<slug>')` and expect that key to exist in
// `ACTIVE_CIFS`, so the slug function must be stable + deterministic.

// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { slugForCifKey } from './local-pro-compute'

describe('slugForCifKey', () => {
  it('lowercases alphanumeric input and preserves word boundaries as underscores', () => {
    expect(slugForCifKey('BaTiO3')).toBe('batio3')
    expect(slugForCifKey('Mn O 2')).toBe('mn_o_2')
    expect(slugForCifKey('MnO2 R-3m')).toBe('mno2_r_3m')
  })

  it('collapses runs of non-alphanumeric characters into single underscores', () => {
    expect(slugForCifKey('my!!!structure#1')).toBe('my_structure_1')
  })

  it('trims leading and trailing underscores', () => {
    expect(slugForCifKey('---hello---')).toBe('hello')
    expect(slugForCifKey('___a___')).toBe('a')
  })

  it('caps output length at 48 characters so the Python var-name remains sane', () => {
    const longInput = 'a'.repeat(200)
    const slug = slugForCifKey(longInput)
    expect(slug.length).toBeLessThanOrEqual(48)
  })

  it('returns the literal string "structure" for inputs that would reduce to an empty slug', () => {
    expect(slugForCifKey('')).toBe('structure')
    expect(slugForCifKey('---')).toBe('structure')
    expect(slugForCifKey('...')).toBe('structure')
  })

  it('is deterministic — same input → same slug across calls', () => {
    const a = slugForCifKey('BaTiO3 tetragonal')
    const b = slugForCifKey('BaTiO3 tetragonal')
    expect(a).toBe(b)
  })
})
