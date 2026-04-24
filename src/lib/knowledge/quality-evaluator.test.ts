// Quality evaluator unit tests.
//
// The four-way split (rejected / diagnostic / accepted) is the write-path
// gate for chains, so the evaluator is the single point where the v2
// prompt's promises ("concrete system, quantitative signal, real
// context_text, no bare characterization") get enforced. Tests below
// lock down each verdict against a representative input.

import { describe, expect, it } from 'vitest'
import { evaluateChainQuality } from './quality-evaluator'

describe('evaluateChainQuality', () => {
  it('rejects chains made of pure generic tokens with no value + no context', () => {
    const result = evaluateChainQuality({
      nodes: [
        { role: 'process', name: 'sintering', value: undefined, unit: undefined },
        { role: 'measurement', name: 'SEM', value: undefined, unit: undefined },
      ],
    })
    expect(result.verdict).toBe('rejected')
    expect(result.reasons).toContain('all-generic-tokens')
  })

  it('rejects chains whose only measurement is a bare technique name', () => {
    const result = evaluateChainQuality({
      nodes: [
        { role: 'system', name: 'Bi2Te3', value: undefined, unit: undefined },
        { role: 'measurement', name: 'XRD', value: undefined, unit: undefined },
      ],
      context_text:
        'Powder X-ray diffraction was performed on the as-synthesised samples at room temperature.',
    })
    expect(result.verdict).toBe('rejected')
    expect(result.reasons).toContain('bare-characterization')
  })

  it('accepts bare-technique measurement when paired with a concrete state descriptor', () => {
    const result = evaluateChainQuality({
      nodes: [
        { role: 'system', name: 'Bi2Te3', value: undefined, unit: undefined },
        { role: 'measurement', name: 'XRD', value: undefined, unit: undefined },
        { role: 'state', name: 'phase', value: 'R-3m rhombohedral', unit: undefined },
      ],
      context_text:
        'XRD confirms a single rhombohedral phase (R-3m) with lattice parameters a=4.38 Å.',
    })
    expect(result.verdict).toBe('accepted')
    expect(result.reasons).toEqual([])
  })

  it('accepts a well-formed chain with concrete system + value + unit + context', () => {
    const result = evaluateChainQuality({
      nodes: [
        { role: 'system', name: 'Bi2Te2.7Se0.3', value: undefined, unit: undefined },
        { role: 'process', name: 'SPS temperature', value: '723', unit: 'K' },
        { role: 'measurement', name: 'peak ZT', value: '1.25', unit: undefined },
      ],
      context_text:
        'SPS-consolidated Bi2Te2.7Se0.3 achieves a peak ZT of 1.25 at 400 K.',
    })
    expect(result.verdict).toBe('accepted')
  })

  it('demotes to diagnostic when system is a generic placeholder', () => {
    const result = evaluateChainQuality({
      nodes: [
        { role: 'system', name: 'sample', value: undefined, unit: undefined },
        { role: 'process', name: 'sintering temperature', value: '1100', unit: '°C' },
        { role: 'measurement', name: 'flexural strength', value: '180', unit: 'MPa' },
      ],
      context_text:
        'The sample sintered at 1100°C showed flexural strength of 180 MPa.',
    })
    expect(result.verdict).toBe('diagnostic')
    expect(result.reasons).toContain('missing-concrete-system')
  })

  it('demotes to diagnostic when context_text is missing / too short', () => {
    const result = evaluateChainQuality({
      nodes: [
        { role: 'system', name: 'Bi2Te3', value: undefined, unit: undefined },
        { role: 'measurement', name: 'conductivity', value: '850', unit: 'S/cm' },
      ],
      context_text: 'short',
    })
    expect(result.verdict).toBe('diagnostic')
    expect(result.reasons).toContain('context-too-short')
  })

  it('accepts when context carries a legible quantity even without node-level value', () => {
    const result = evaluateChainQuality({
      nodes: [
        { role: 'system', name: 'NiCoMn-layered hydroxide', value: undefined, unit: undefined },
        { role: 'state', name: 'crystallinity', value: 'highly crystalline', unit: undefined },
      ],
      context_text:
        'The NiCoMn-layered hydroxide shows a specific capacity of 215 mAh/g at 1 A current density.',
    })
    // Context has "215" with unit-ish "A"/"mAh"... The CONTEXT_HAS_QUANTITY
    // regex only whitelists specific unit tokens; "mAh" is not in it, but
    // "1 A" matches. So this should pass.
    expect(result.verdict).toBe('accepted')
  })
})
