import { describe, expect, it } from 'vitest'
import {
  applyRirCorrection,
  formulaToRirKey,
  lookupRir,
} from './xrd-rir'

describe('formulaToRirKey', () => {
  it('lowercases and strips whitespace', () => {
    expect(formulaToRirKey(' Fe2O3 ')).toBe('fe2o3')
    expect(formulaToRirKey('SiO2')).toBe('sio2')
  })
  it('drops trailing phase qualifier in parentheses', () => {
    expect(formulaToRirKey('TiO2 (rutile)')).toBe('tio2')
  })
  it('handles empty / null', () => {
    expect(formulaToRirKey(undefined)).toBe('')
    expect(formulaToRirKey(null)).toBe('')
    expect(formulaToRirKey('   ')).toBe('')
  })
})

describe('lookupRir', () => {
  it('finds common oxides', () => {
    expect(lookupRir('Al2O3')).toBe(1.0)
    expect(lookupRir('Fe2O3')).toBeCloseTo(2.6)
    expect(lookupRir('SiO2')).toBeCloseTo(3.37)
  })
  it('returns null for unknown formulae', () => {
    expect(lookupRir('Sc2O3')).toBeNull()
    expect(lookupRir('Fake')).toBeNull()
    expect(lookupRir('')).toBeNull()
  })
})

describe('applyRirCorrection', () => {
  it('normalises weight fractions to sum 100 over phases with RIR', () => {
    // Two-phase mixture with equal weight_pct but different RIRs: the
    // stronger-scattering phase should lose weight after correction.
    const out = applyRirCorrection([
      { formula: 'Al2O3', weight_pct: 50 }, // RIR 1.0
      { formula: 'Fe2O3', weight_pct: 50 }, // RIR 2.6
    ])
    const total = out.reduce((s, p) => s + (p.correctedPct ?? 0), 0)
    expect(total).toBeCloseTo(100, 3)
    // Al2O3 has smaller RIR → should end up with larger corrected wt%
    const al = out.find((p) => p.formula === 'Al2O3')!
    const fe = out.find((p) => p.formula === 'Fe2O3')!
    expect(al.correctedPct!).toBeGreaterThan(fe.correctedPct!)
  })

  it('marks phases without RIR entries as null', () => {
    const out = applyRirCorrection([
      { formula: 'Al2O3', weight_pct: 30 },
      { formula: 'Sc2O3', weight_pct: 70 }, // not in table
    ])
    const sc = out.find((p) => p.formula === 'Sc2O3')!
    expect(sc.correctedPct).toBeNull()
    expect(sc.rir).toBeNull()
    // Al2O3 still gets a corrected pct (only contributor)
    const al = out.find((p) => p.formula === 'Al2O3')!
    expect(al.correctedPct).toBeCloseTo(100, 3)
  })

  it('returns 0 for zero-weight phases that DO have RIR data', () => {
    const out = applyRirCorrection([
      { formula: 'Al2O3', weight_pct: 100 },
      { formula: 'SiO2', weight_pct: 0 },
    ])
    const si = out.find((p) => p.formula === 'SiO2')!
    expect(si.correctedPct).toBe(0)
  })

  it('preserves phase_name and formula on the output', () => {
    const out = applyRirCorrection([
      { formula: 'Fe2O3', phase_name: 'Hematite', weight_pct: 50 },
    ])
    expect(out[0].phase_name).toBe('Hematite')
    expect(out[0].formula).toBe('Fe2O3')
  })
})
