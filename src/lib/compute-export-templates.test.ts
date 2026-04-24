// Tier 1 · unit tests for the Structure → LAMMPS / CP2K export templates.

import { describe, it, expect } from 'vitest'
import {
  buildCp2kExportCell,
  buildExportTemplate,
  buildLammpsExportCell,
  ELEMENT_DEFAULT_Q,
} from './compute-export-templates'
import type { ParsedCif } from './cif'

// Minimal cubic BaTiO3 as an in-memory ParsedCif — mirrors the CIF
// fixture used by cif.test.ts. We don't parse here; constructing the
// struct directly keeps the test pure TS + deterministic.
const BATIO3: ParsedCif = {
  dataBlock: 'BaTiO3',
  lattice: { a: 3.994, b: 3.994, c: 3.994, alpha: 90, beta: 90, gamma: 90 },
  spaceGroup: 'P m -3 m',
  sites: [
    { label: 'Ba1', element: 'Ba', fx: 0.0, fy: 0.0, fz: 0.0, occ: 1 },
    { label: 'Ti1', element: 'Ti', fx: 0.5, fy: 0.5, fz: 0.5, occ: 1 },
    { label: 'O1', element: 'O', fx: 0.5, fy: 0.5, fz: 0.0, occ: 1 },
    { label: 'O2', element: 'O', fx: 0.5, fy: 0.0, fz: 0.5, occ: 1 },
    { label: 'O3', element: 'O', fx: 0.0, fy: 0.5, fz: 0.5, occ: 1 },
  ],
}

// ── CP2K ───────────────────────────────────────────────────────────

describe('buildCp2kExportCell', () => {
  const result = buildCp2kExportCell({
    slug: 'batio3',
    formula: 'BaTiO3',
    parentStructureId: 'art_1',
    parsedCif: BATIO3,
  })

  it('spawns a native cp2k cell (not a Python wrapper)', () => {
    expect(result.cellKind).toBe('cp2k')
    expect(result.title).toMatch(/CP2K.*BaTiO3/)
    expect(result.provenance.operation).toBe('export:cp2k')
    expect(result.provenance.parentStructureId).toBe('art_1')
  })

  it('emits a complete CP2K input skeleton with the required sections', () => {
    expect(result.code).toContain('&GLOBAL')
    expect(result.code).toContain('&END GLOBAL')
    expect(result.code).toContain('&FORCE_EVAL')
    expect(result.code).toContain('METHOD QS')
    expect(result.code).toContain('&DFT')
    expect(result.code).toContain('&XC_FUNCTIONAL PBE')
    expect(result.code).toContain('&SUBSYS')
  })

  it('inlines the cell vectors at ≥6 decimal precision', () => {
    // 3.994 → padded to 3.994000 by fmt().
    expect(result.code).toContain('A [angstrom] 3.994000 0.0 0.0')
    expect(result.code).toContain('B [angstrom] 0.0 3.994000 0.0')
    expect(result.code).toContain('C [angstrom] 0.0 0.0 3.994000')
  })

  it('inlines fractional coordinates under &COORD SCALED', () => {
    expect(result.code).toContain('&COORD')
    expect(result.code).toContain('SCALED')
    // Ba at origin; Ti at centre.
    expect(result.code).toMatch(/Ba\s+0\.000000\s+0\.000000\s+0\.000000/)
    expect(result.code).toMatch(/Ti\s+0\.500000\s+0\.500000\s+0\.500000/)
    expect(result.code).toContain('&END COORD')
  })

  it('emits one &KIND block per unique element, using the default Q map', () => {
    expect(result.code).toContain('&KIND Ba')
    expect(result.code).toContain('&KIND Ti')
    expect(result.code).toContain('&KIND O')
    // Ba → q10, Ti → q12, O → q6 per ELEMENT_DEFAULT_Q.
    expect(result.code).toContain(`POTENTIAL GTH-PBE-q${ELEMENT_DEFAULT_Q.Ba}`)
    expect(result.code).toContain(`POTENTIAL GTH-PBE-q${ELEMENT_DEFAULT_Q.Ti}`)
    expect(result.code).toContain(`POTENTIAL GTH-PBE-q${ELEMENT_DEFAULT_Q.O}`)
  })

  it('flags unknown elements with a TODO header and falls back to GTH-PBE without a q suffix', () => {
    const exotic: ParsedCif = {
      ...BATIO3,
      sites: [
        ...BATIO3.sites,
        // Element not in the default-Q map — should trigger the warning.
        { label: 'Uut1', element: 'Uut', fx: 0, fy: 0, fz: 0, occ: 1 },
      ],
    }
    const r = buildCp2kExportCell({
      slug: 'exotic',
      formula: 'BaTiO3-Uut',
      parsedCif: exotic,
    })
    expect(r.code).toMatch(/WARNING: unknown element/)
    expect(r.code).toMatch(/Uut/)
    // No q-suffix for Uut (plain GTH-PBE).
    expect(r.code).toMatch(/&KIND Uut[\s\S]+POTENTIAL GTH-PBE\b/)
  })

  it('warns on non-orthorhombic lattices that the A/B/C vectors must be edited', () => {
    const triclinic: ParsedCif = {
      ...BATIO3,
      lattice: { ...BATIO3.lattice, alpha: 105 },
    }
    const r = buildCp2kExportCell({
      slug: 'tri',
      formula: 'tri',
      parsedCif: triclinic,
    })
    expect(r.code).toMatch(/TODO:.*not orthorhombic/i)
  })
})

// ── LAMMPS ─────────────────────────────────────────────────────────

describe('buildLammpsExportCell', () => {
  const result = buildLammpsExportCell({
    slug: 'batio3',
    formula: 'BaTiO3',
    parentStructureId: 'art_1',
    parsedCif: BATIO3,
  })

  it('spawns a structure-code Python cell (Python-bridged path)', () => {
    expect(result.cellKind).toBe('structure-code')
    expect(result.title).toMatch(/LAMMPS.*BaTiO3/)
    expect(result.provenance.operation).toBe('export:lammps')
    expect(result.provenance.parentStructureId).toBe('art_1')
  })

  it('materialises the LAMMPS data file via ASE and runs `lmp`', () => {
    expect(result.code).toContain("load_structure('batio3')")
    expect(result.code).toContain('AseAtomsAdaptor.get_atoms(s)')
    expect(result.code).toContain("format='lammps-data'")
    expect(result.code).toContain('data.batio3')
    expect(result.code).toContain('in.batio3')
    expect(result.code).toContain("'lmp', '-in'")
  })

  it('leaves pair_style / pair_coeff as clearly-marked TODOs', () => {
    // `.` doesn't match newlines by default; use the `s` flag so the
    // multi-line TODO block is visible.
    expect(result.code).toMatch(/TODO[\s\S]*pair_style[\s\S]*pair_coeff/i)
  })
})

// ── Dispatcher ─────────────────────────────────────────────────────

describe('buildExportTemplate (dispatcher)', () => {
  it('routes "cp2k" to buildCp2kExportCell', () => {
    const r = buildExportTemplate('cp2k', {
      slug: 'batio3',
      formula: 'BaTiO3',
      parsedCif: BATIO3,
    })
    expect(r.cellKind).toBe('cp2k')
  })

  it('routes "lammps" to buildLammpsExportCell', () => {
    const r = buildExportTemplate('lammps', {
      slug: 'batio3',
      formula: 'BaTiO3',
      parsedCif: BATIO3,
    })
    expect(r.cellKind).toBe('structure-code')
  })
})
