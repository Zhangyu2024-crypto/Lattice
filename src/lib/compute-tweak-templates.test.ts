// Tier 1 · unit tests for the Structure → Compute "Tweak ▾" templates.

import { describe, it, expect } from 'vitest'
import {
  buildDopeTweak,
  buildSupercellTweak,
  buildSurfaceTweak,
  buildVacancyTweak,
} from './compute-tweak-templates'

describe('buildSupercellTweak', () => {
  it('emits `s * (nx, ny, nz)` with the caller-supplied dims', () => {
    const r = buildSupercellTweak('batio3', { nx: 2, ny: 3, nz: 4 })
    expect(r.code).toContain("load_structure('batio3')")
    expect(r.code).toContain('s = s * (2, 3, 4)')
    expect(r.title).toContain('2×3×4')
  })

  it('tags provenance.operation with the params so the back-link is readable', () => {
    const r = buildSupercellTweak('x', { nx: 2, ny: 2, nz: 2 })
    expect(r.provenance.operation).toMatch(/supercell\(2,2,2\)/)
    expect(r.provenance.parentCellId).toBe('x')
  })

  it('accepts 1x1x1 identity (no-op) — the UI decides whether to disable; the template is permissive', () => {
    const r = buildSupercellTweak('x', { nx: 1, ny: 1, nz: 1 })
    expect(r.code).toContain('s = s * (1, 1, 1)')
  })
})

describe('buildDopeTweak', () => {
  it('includes replace logic keyed on the fromElement and targets toElement', () => {
    const r = buildDopeTweak('batio3', {
      fromElement: 'Ti',
      toElement: 'Zr',
      fraction: 0.5,
    })
    expect(r.code).toContain("FROM = 'Ti'")
    expect(r.code).toContain("TO = 'Zr'")
    expect(r.code).toContain('FRACTION = 0.5')
    expect(r.code).toContain("load_structure('batio3')")
    expect(r.title).toMatch(/Ti.*Zr/)
    expect(r.provenance.operation).toMatch(/dope.*Ti.*Zr.*0\.5/)
  })

  it('defaults fraction to 0.25 when caller omits it', () => {
    const r = buildDopeTweak('x', { fromElement: 'Ba', toElement: 'Sr' })
    expect(r.code).toContain('FRACTION = 0.25')
  })
})

describe('buildSurfaceTweak', () => {
  it('produces a runnable surface-slab cell referencing the parent structure', () => {
    const r = buildSurfaceTweak('batio3', {
      miller: [1, 0, 0],
      minSlab: 8,
      minVacuum: 12,
    })
    expect(r.code).toContain("load_structure('batio3')")
    // Miller index rendered as a Python tuple literal.
    expect(r.code).toContain('(1, 0, 0)')
    expect(r.code).toContain('MIN_SLAB = 8')
    expect(r.code).toContain('MIN_VACUUM = 12')
    expect(r.code).toMatch(/SlabGenerator/)
    expect(r.title).toMatch(/\(1 *0 *0\)/)
  })
})

describe('buildVacancyTweak', () => {
  it('samples N sites of the target element and removes them with a seeded PRNG', () => {
    const r = buildVacancyTweak('batio3', { element: 'O', count: 2, seed: 5 })
    expect(r.code).toContain("load_structure('batio3')")
    expect(r.code).toContain("ELEMENT = 'O'")
    expect(r.code).toContain('COUNT = 2')
    expect(r.code).toContain('SEED = 5')
    expect(r.code).toContain('random.sample')
    expect(r.code).toContain('s.remove_sites')
    expect(r.title).toMatch(/Vacancy O.*2/)
    expect(r.provenance.operation).toMatch(/vacancy\(O,2\)/)
  })

  it('defaults count=1 and seed=0 when params omit them', () => {
    const r = buildVacancyTweak('batio3', { element: 'O' })
    expect(r.code).toContain('COUNT = 1')
    expect(r.code).toContain('SEED = 0')
  })

  it('guards against removing more sites than exist', () => {
    const r = buildVacancyTweak('batio3', { element: 'O', count: 3 })
    expect(r.code).toMatch(/cannot remove/i)
  })
})
