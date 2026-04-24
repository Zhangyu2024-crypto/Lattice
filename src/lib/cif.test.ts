// Smoke test for the CIF parser + derived helpers (Tier 1).
//
// These tests pin the contract of `parseCif` / `computeFormula` /
// `computeLatticeParams` against a small set of hand-authored CIFs —
// the same fixtures the Compute Structure pipeline relies on. They
// run under the default (jsdom) Vitest env so the same suite can
// cross-reference DOM-bound helpers later if needed.

import { describe, it, expect } from 'vitest'
import {
  computeFormula,
  computeLatticeParams,
  dope,
  parseCif,
  supercell,
  writeCif,
} from './cif'

// ── Fixtures ────────────────────────────────────────────────────────
// Minimal cubic BaTiO3 — the canonical demo structure used elsewhere
// in the codebase (ComputeNotebook's structure-code starter pastes a
// near-identical block). Uses the short five-atom convention.
const BATIO3_CUBIC = `data_BaTiO3
_cell_length_a 3.994
_cell_length_b 3.994
_cell_length_c 3.994
_cell_angle_alpha 90.0
_cell_angle_beta 90.0
_cell_angle_gamma 90.0
_symmetry_space_group_name_H-M 'P m -3 m'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
Ba1 Ba 0.0 0.0 0.0 1.0
Ti1 Ti 0.5 0.5 0.5 1.0
O1 O 0.5 0.5 0.0 1.0
O2 O 0.5 0.0 0.5 1.0
O3 O 0.0 0.5 0.5 1.0
`

// ── parseCif ────────────────────────────────────────────────────────

describe('parseCif', () => {
  it('pulls cell parameters, space group, and five atom sites from a cubic BaTiO3 CIF', () => {
    const parsed = parseCif(BATIO3_CUBIC)
    expect(parsed.dataBlock).toBe('BaTiO3')
    expect(parsed.lattice.a).toBeCloseTo(3.994, 3)
    expect(parsed.lattice.alpha).toBe(90)
    expect(parsed.spaceGroup).toBe('P m -3 m')
    expect(parsed.sites).toHaveLength(5)
    expect(parsed.sites.map((s) => s.element).sort()).toEqual([
      'Ba',
      'O',
      'O',
      'O',
      'Ti',
    ])
  })

  it('strips CIF standard-deviation parentheses from number fields', () => {
    // `3.994(2)` is a common notation; the parser should discard the
    // uncertainty and keep just the central value.
    const withUncertainty = BATIO3_CUBIC.replace('3.994', '3.994(2)')
    const parsed = parseCif(withUncertainty)
    expect(parsed.lattice.a).toBeCloseTo(3.994, 3)
  })

  it('throws when cell parameters are missing', () => {
    const broken = BATIO3_CUBIC.replace('_cell_length_a 3.994\n', '')
    expect(() => parseCif(broken)).toThrow(/cell parameter/i)
  })

  it('throws when the CIF has no atom_site loop', () => {
    const noSites = `data_empty
_cell_length_a 3.994
_cell_length_b 3.994
_cell_length_c 3.994
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
`
    expect(() => parseCif(noSites)).toThrow(/atom sites/i)
  })
})

// ── computeFormula ──────────────────────────────────────────────────

describe('computeFormula', () => {
  it('reduces BaTiO3 sites to the conventional formula', () => {
    const parsed = parseCif(BATIO3_CUBIC)
    expect(computeFormula(parsed.sites)).toBe('BaO3Ti')
  })

  it('normalises an empty site list to the empty string', () => {
    expect(computeFormula([])).toBe('')
  })
})

// ── computeLatticeParams ────────────────────────────────────────────

describe('computeLatticeParams', () => {
  it('returns a defensive copy of the parsed lattice object', () => {
    const parsed = parseCif(BATIO3_CUBIC)
    const lp = computeLatticeParams(parsed)
    expect(lp).toEqual(parsed.lattice)
    // Mutating the returned object must not affect the parsed struct —
    // this is the invariant the rest of the codebase assumes when it
    // passes lattice params across the Compute → Structure boundary.
    lp.a = 99
    expect(parsed.lattice.a).toBeCloseTo(3.994, 3)
  })
})

// ── Transform · supercell ───────────────────────────────────────────

describe('supercell', () => {
  it('2×2×2 of BaTiO3 yields 5 × 8 = 40 sites with scaled lattice vectors', () => {
    const parsed = parseCif(BATIO3_CUBIC)
    const sc = supercell(parsed, 2, 2, 2)
    expect(sc.sites).toHaveLength(40)
    expect(sc.lattice.a).toBeCloseTo(parsed.lattice.a * 2, 6)
    expect(sc.lattice.b).toBeCloseTo(parsed.lattice.b * 2, 6)
    expect(sc.lattice.c).toBeCloseTo(parsed.lattice.c * 2, 6)
    expect(sc.spaceGroup).toBe('P 1') // SC collapses symmetry
  })

  it('1×1×1 is a near-identity (site count preserved; labels gain a 000 suffix)', () => {
    const parsed = parseCif(BATIO3_CUBIC)
    const sc = supercell(parsed, 1, 1, 1)
    expect(sc.sites).toHaveLength(parsed.sites.length)
    expect(sc.lattice.a).toBeCloseTo(parsed.lattice.a, 6)
    expect(sc.sites[0].label).toMatch(/_000$/)
  })

  it('rejects non-positive dimensions', () => {
    const parsed = parseCif(BATIO3_CUBIC)
    expect(() => supercell(parsed, 0, 1, 1)).toThrow(/≥ 1/)
    expect(() => supercell(parsed, 1, -1, 1)).toThrow(/≥ 1/)
  })
})

// ── Transform · dope ────────────────────────────────────────────────

describe('dope', () => {
  it('substitutes Ti→Zr at 100% fraction; all Ti sites become Zr', () => {
    const parsed = parseCif(BATIO3_CUBIC)
    const doped = dope(parsed, {
      targetElement: 'Ti',
      dopant: 'Zr',
      fraction: 1.0,
      seed: 42,
    })
    const elems = doped.sites.map((s) => s.element)
    expect(elems.filter((e) => e === 'Ti')).toHaveLength(0)
    expect(elems.filter((e) => e === 'Zr')).toHaveLength(1)
  })

  it('is deterministic given a seed', () => {
    const parsed = parseCif(BATIO3_CUBIC)
    const bigSc = supercell(parsed, 2, 2, 2) // more Ti sites to sample from
    const a = dope(bigSc, {
      targetElement: 'Ti',
      dopant: 'Zr',
      fraction: 0.5,
      seed: 7,
    })
    const b = dope(bigSc, {
      targetElement: 'Ti',
      dopant: 'Zr',
      fraction: 0.5,
      seed: 7,
    })
    expect(a.sites.map((s) => s.element)).toEqual(b.sites.map((s) => s.element))
  })

  it('different seeds pick different subsets', () => {
    const parsed = parseCif(BATIO3_CUBIC)
    const bigSc = supercell(parsed, 2, 2, 2)
    const a = dope(bigSc, {
      targetElement: 'Ti',
      dopant: 'Zr',
      fraction: 0.5,
      seed: 1,
    })
    const b = dope(bigSc, {
      targetElement: 'Ti',
      dopant: 'Zr',
      fraction: 0.5,
      seed: 99,
    })
    // Position-by-position comparison — at least one site must differ.
    const diff = a.sites.some((s, i) => s.element !== b.sites[i].element)
    expect(diff).toBe(true)
  })
})

// ── writeCif roundtrip ──────────────────────────────────────────────

describe('writeCif', () => {
  it('round-trips a parsed CIF back into a parseable CIF with matching lattice', () => {
    const parsed = parseCif(BATIO3_CUBIC)
    const out = writeCif(parsed)
    const reparsed = parseCif(out)
    expect(reparsed.lattice.a).toBeCloseTo(parsed.lattice.a, 4)
    expect(reparsed.sites).toHaveLength(parsed.sites.length)
    // Elements preserved (order may change; compare as sorted multisets).
    expect(reparsed.sites.map((s) => s.element).sort()).toEqual(
      parsed.sites.map((s) => s.element).sort(),
    )
  })
})
