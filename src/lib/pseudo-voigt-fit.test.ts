import { describe, expect, it } from 'vitest'
import {
  fitPseudoVoigt,
  pseudoVoigtAt,
  pseudoVoigtCurve,
} from './pseudo-voigt-fit'

function synthSpectrum(
  params: { amplitude: number; center: number; fwhm: number; eta: number },
  window: { min: number; max: number; n: number },
  noiseSeed = 0,
): { x: number[]; y: number[] } {
  const x: number[] = []
  const step = (window.max - window.min) / (window.n - 1)
  for (let i = 0; i < window.n; i++) x.push(window.min + i * step)
  const y = pseudoVoigtCurve(x, params)
  if (noiseSeed > 0) {
    // Deterministic pseudo-noise so tests are repeatable.
    let s = noiseSeed
    for (let i = 0; i < y.length; i++) {
      s = (s * 9301 + 49297) % 233280
      const r = (s / 233280 - 0.5) * 2 // [-1, 1]
      y[i] += r * noiseSeed * 0.01
    }
  }
  return { x, y }
}

describe('pseudoVoigtAt', () => {
  it('peaks at the center with height = amplitude', () => {
    const h = pseudoVoigtAt(30, { amplitude: 100, center: 30, fwhm: 0.2, eta: 0.5 })
    expect(h).toBeCloseTo(100, 5)
  })

  it('is symmetric about the center', () => {
    const p = { amplitude: 50, center: 45, fwhm: 0.3, eta: 0.4 }
    expect(pseudoVoigtAt(45 - 0.1, p)).toBeCloseTo(pseudoVoigtAt(45 + 0.1, p))
  })

  it('at x = center ± fwhm/2 the height is ≈ amplitude/2', () => {
    const p = { amplitude: 100, center: 30, fwhm: 0.2, eta: 0.5 }
    const half = pseudoVoigtAt(30.1, p)
    expect(half).toBeCloseTo(50, 1)
  })
})

describe('fitPseudoVoigt', () => {
  it('recovers parameters from clean synthetic data', () => {
    const truth = { amplitude: 80, center: 32.5, fwhm: 0.25, eta: 0.3 }
    const { x, y } = synthSpectrum(truth, { min: 31, max: 34, n: 201 })
    const result = fitPseudoVoigt(x, y, {
      amplitude: 50,
      center: 32.3,
      fwhm: 0.4,
      eta: 0.5,
    })
    expect(result.converged).toBe(true)
    expect(result.params.amplitude).toBeCloseTo(truth.amplitude, 1)
    expect(result.params.center).toBeCloseTo(truth.center, 3)
    expect(result.params.fwhm).toBeCloseTo(truth.fwhm, 3)
    expect(result.params.eta).toBeCloseTo(truth.eta, 2)
    expect(result.rSquared).toBeGreaterThan(0.999)
  })

  it('handles noisy data and still reports R² > 0.9', () => {
    const truth = { amplitude: 100, center: 45, fwhm: 0.3, eta: 0.6 }
    const { x, y } = synthSpectrum(truth, { min: 43, max: 47, n: 201 }, 100)
    const result = fitPseudoVoigt(x, y, {
      amplitude: 60,
      center: 44.8,
      fwhm: 0.5,
      eta: 0.3,
    })
    expect(result.params.center).toBeCloseTo(truth.center, 1)
    expect(result.params.fwhm).toBeCloseTo(truth.fwhm, 1)
    expect(result.rSquared).toBeGreaterThan(0.9)
  })

  it('returns parameter errors on a well-conditioned fit', () => {
    const truth = { amplitude: 50, center: 20, fwhm: 0.4, eta: 0.5 }
    const { x, y } = synthSpectrum(truth, { min: 18, max: 22, n: 401 })
    const result = fitPseudoVoigt(x, y, { ...truth, fwhm: 0.5 })
    expect(result.paramErrors).not.toBeNull()
    expect(result.paramErrors!.center).toBeLessThan(0.01)
  })

  it('respects eta bounds [0, 1]', () => {
    const truth = { amplitude: 50, center: 20, fwhm: 0.4, eta: 0.9 }
    const { x, y } = synthSpectrum(truth, { min: 18, max: 22, n: 201 })
    // Seed eta way above 1 — should clamp back to [0, 1]
    const result = fitPseudoVoigt(x, y, {
      amplitude: 50,
      center: 20,
      fwhm: 0.4,
      eta: 5.0,
    })
    expect(result.params.eta).toBeLessThanOrEqual(1)
    expect(result.params.eta).toBeGreaterThanOrEqual(0)
  })

  it('enforces fwhm floor (doesn\'t return zero-width)', () => {
    // All-zero y → the model should not collapse fwhm below the floor.
    const x = Array.from({ length: 50 }, (_, i) => i * 0.1)
    const y = new Array(50).fill(0.001)
    const result = fitPseudoVoigt(x, y, {
      amplitude: 1,
      center: 2.5,
      fwhm: 0.1,
      eta: 0.5,
    })
    expect(result.params.fwhm).toBeGreaterThanOrEqual(1e-4)
  })
})
