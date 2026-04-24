// Tier 1 · unit tests for the Structure → Simulate templates.
//
// These tests pin the three contract fields the parent flow depends on:
//   - cellKind       → StructureArtifactCard spawns a `structure-code` cell
//   - code contains  → `load_structure('<slug>')` so ACTIVE_CIFS picks up
//                      the parent structure with the exact same key
//                      `slugForCifKey` used when publishing the artifact
//   - title / provenance.parentStructureId → so back-links work

import { describe, it, expect } from 'vitest'
import {
  buildSimulateTemplate,
  type SimulateTemplateInput,
} from './compute-simulate-templates'

const SAMPLE: SimulateTemplateInput = {
  slug: 'batio3',
  formula: 'BaTiO3',
  parentStructureId: 'a_struct_1',
}

describe('buildSimulateTemplate', () => {
  it('md-ase — spawns a structure-code cell with ASE Langevin boilerplate referencing the parent slug', () => {
    const t = buildSimulateTemplate('md-ase', SAMPLE)
    expect(t.cellKind).toBe('structure-code')
    expect(t.title).toMatch(/MD.*BaTiO3/)
    expect(t.code).toContain("load_structure('batio3')")
    expect(t.code).toContain('Langevin')
    expect(t.code).toContain('temperature_K=300')
    expect(t.provenance.parentStructureId).toBe('a_struct_1')
    expect(t.provenance.operation).toMatch(/simulate.*md/i)
  })

  it('dft-cp2k — spawns a structure-code cell with CP2K input + pymatgen bridge', () => {
    const t = buildSimulateTemplate('dft-cp2k', SAMPLE)
    expect(t.cellKind).toBe('structure-code')
    expect(t.title).toMatch(/DFT.*BaTiO3/)
    expect(t.code).toContain("load_structure('batio3')")
    // The template should emit CP2K input text (either via pymatgen's
    // Cp2kInput or a raw &FORCE_EVAL/&SUBSYS block).
    expect(t.code).toMatch(/cp2k|FORCE_EVAL|&SUBSYS/i)
    expect(t.provenance.parentStructureId).toBe('a_struct_1')
    expect(t.provenance.operation).toMatch(/simulate.*dft/i)
  })

  it('py-play — scratch-pad cell keeps the slug reference so ACTIVE_CIFS works', () => {
    const t = buildSimulateTemplate('py-play', SAMPLE)
    expect(t.cellKind).toBe('structure-code')
    expect(t.title).toMatch(/Playground.*BaTiO3/)
    expect(t.code).toContain("load_structure('batio3')")
    expect(t.provenance.parentStructureId).toBe('a_struct_1')
  })

  it('honors exotic slugs verbatim (no second-round sanitization)', () => {
    // Caller (StructureArtifactCard) already passes a sanitized slug via
    // `slugForCifKey`; the template must use it as-is to match what
    // `buildRunContext` injected into ACTIVE_CIFS.
    const t = buildSimulateTemplate('py-play', {
      slug: 'mno2_r_3_m_phase_01',
      formula: 'MnO2',
      parentStructureId: 'struct_x',
    })
    expect(t.code).toContain("load_structure('mno2_r_3_m_phase_01')")
  })
})
