import { describe, expect, it } from 'vitest'
import { synthesizePattern } from './xrd-pattern-synthesis'

describe('synthesizePattern', () => {
  it('returns empty arrays when the range is inverted', () => {
    const out = synthesizePattern([{ twoTheta: 30, relIntensity: 1 }], {
      twoThetaMin: 40,
      twoThetaMax: 20,
    })
    expect(out.x).toHaveLength(0)
    expect(out.y).toHaveLength(0)
  })

  it('produces nPoints-long arrays covering the requested range', () => {
    const out = synthesizePattern([{ twoTheta: 30, relIntensity: 1 }], {
      twoThetaMin: 10,
      twoThetaMax: 80,
      nPoints: 701,
    })
    expect(out.x).toHaveLength(701)
    expect(out.y).toHaveLength(701)
    expect(out.x[0]).toBeCloseTo(10)
    expect(out.x[700]).toBeCloseTo(80)
  })

  it('peaks at the reference position', () => {
    const out = synthesizePattern([{ twoTheta: 40, relIntensity: 1 }], {
      twoThetaMin: 10,
      twoThetaMax: 80,
      nPoints: 2001,
      fwhmDeg: 0.5,
    })
    // Find the index of max y — should be very near 40° (within step size)
    let maxIdx = 0
    for (let i = 1; i < out.y.length; i++) {
      if (out.y[i] > out.y[maxIdx]) maxIdx = i
    }
    const step = (80 - 10) / 2000
    expect(Math.abs(out.x[maxIdx] - 40)).toBeLessThan(step * 2)
  })

  it('scales intensities linearly', () => {
    const singleA = synthesizePattern([{ twoTheta: 40, relIntensity: 0.5 }], {
      twoThetaMin: 30,
      twoThetaMax: 50,
      nPoints: 1001,
      scale: 100,
    })
    const singleB = synthesizePattern([{ twoTheta: 40, relIntensity: 1.0 }], {
      twoThetaMin: 30,
      twoThetaMax: 50,
      nPoints: 1001,
      scale: 100,
    })
    const maxA = Math.max(...singleA.y)
    const maxB = Math.max(...singleB.y)
    expect(maxB / maxA).toBeCloseTo(2, 1)
  })

  it('skips peaks outside the range', () => {
    const out = synthesizePattern(
      [
        { twoTheta: 5, relIntensity: 1 }, // below range
        { twoTheta: 90, relIntensity: 1 }, // above range
      ],
      { twoThetaMin: 20, twoThetaMax: 80 },
    )
    const maxY = Math.max(...out.y)
    // Tails from out-of-range peaks at ±6×FWHM=0.6° shouldn't reach
    // into the window center; baseline ~ 0.
    expect(maxY).toBeLessThan(0.01)
  })

  it('ignores non-finite / non-positive intensities', () => {
    const out = synthesizePattern(
      [
        { twoTheta: 40, relIntensity: Number.NaN },
        { twoTheta: 45, relIntensity: 0 },
        { twoTheta: 50, relIntensity: -1 },
      ],
      { twoThetaMin: 30, twoThetaMax: 60 },
    )
    expect(Math.max(...out.y)).toBe(0)
  })
})
