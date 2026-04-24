import { describe, expect, it } from 'vitest'
import type { XpsProPeakDef } from '../types/artifact'
import { buildXpsSpecs } from './xps-peak-spec-build'

const singleDef = (patch: Partial<XpsProPeakDef> = {}): XpsProPeakDef => ({
  id: patch.id ?? 's1',
  label: patch.label ?? 'C 1s',
  type: 'single',
  position: patch.position ?? 284.8,
  intensity: patch.intensity ?? 5000,
  fwhm: patch.fwhm ?? 1.2,
  ...patch,
})

const doubletDef = (patch: Partial<XpsProPeakDef> = {}): XpsProPeakDef => ({
  id: patch.id ?? 'd1',
  label: patch.label ?? 'Fe 2p',
  type: 'doublet',
  position: patch.position ?? 710.5,
  intensity: patch.intensity ?? 8000,
  fwhm: patch.fwhm ?? 1.5,
  split: patch.split ?? 13.6,
  branchingRatio: patch.branchingRatio ?? 0.5,
  ...patch,
})

describe('buildXpsSpecs', () => {
  it('partitions singles and doublets', () => {
    const { peaks, doublets } = buildXpsSpecs(
      [singleDef(), doubletDef(), singleDef({ id: 's2', label: 'O 1s' })],
      { defaultVoigtEta: 0.3 },
    )
    expect(peaks).toHaveLength(2)
    expect(doublets).toHaveLength(1)
    expect(peaks[0].name).toBe('C 1s')
    expect(peaks[1].name).toBe('O 1s')
    expect(doublets[0].base_name).toBe('Fe 2p')
  })

  it('falls back to the workbench default η when a peak omits voigtEta', () => {
    const { peaks } = buildXpsSpecs([singleDef()], { defaultVoigtEta: 0.4 })
    expect(peaks[0].fraction).toBeCloseTo(0.4)
  })

  it('honours a per-peak voigtEta override', () => {
    const { peaks } = buildXpsSpecs(
      [singleDef({ voigtEta: 0.9 })],
      { defaultVoigtEta: 0.3 },
    )
    expect(peaks[0].fraction).toBeCloseTo(0.9)
  })

  it('applies voigtEta to doublets too', () => {
    const { doublets } = buildXpsSpecs(
      [doubletDef({ voigtEta: 0.1 })],
      { defaultVoigtEta: 0.5 },
    )
    expect(doublets[0].fraction).toBeCloseTo(0.1)
  })

  it('translates fixedPosition / fixedFwhm to vary_* flags', () => {
    const { peaks } = buildXpsSpecs(
      [singleDef({ fixedPosition: true, fixedFwhm: true })],
      { defaultVoigtEta: 0.5 },
    )
    expect(peaks[0].vary_center).toBe(false)
    expect(peaks[0].vary_fwhm).toBe(false)
  })

  it('leaves vary flags undefined when not fixed (worker default = float)', () => {
    const { peaks } = buildXpsSpecs(
      [singleDef()],
      { defaultVoigtEta: 0.5 },
    )
    expect(peaks[0].vary_center).toBeUndefined()
    expect(peaks[0].vary_fwhm).toBeUndefined()
  })

  it('doublet fallbacks: split defaults 5 eV, ratio defaults 0.5', () => {
    const { doublets } = buildXpsSpecs(
      [
        {
          id: 'd2',
          label: 'bare',
          type: 'doublet',
          position: 700,
          intensity: 1000,
          fwhm: 1.2,
        },
      ],
      { defaultVoigtEta: 0.5 },
    )
    expect(doublets[0].split).toBe(5)
    expect(doublets[0].area_ratio).toBe(0.5)
  })

  it('leaves vary_split / vary_area_ratio undefined by default (locked)', () => {
    const { doublets } = buildXpsSpecs([doubletDef()], {
      defaultVoigtEta: 0.5,
    })
    expect(doublets[0].vary_split).toBeUndefined()
    expect(doublets[0].vary_area_ratio).toBeUndefined()
  })

  it('promotes split / ratio to free variables when the user unlocks them', () => {
    const { doublets } = buildXpsSpecs(
      [doubletDef({ fixedSplit: false, fixedBranching: false })],
      { defaultVoigtEta: 0.5 },
    )
    expect(doublets[0].vary_split).toBe(true)
    expect(doublets[0].vary_area_ratio).toBe(true)
  })

  it('locks independently (split free, ratio locked)', () => {
    const { doublets } = buildXpsSpecs(
      [doubletDef({ fixedSplit: false, fixedBranching: true })],
      { defaultVoigtEta: 0.5 },
    )
    expect(doublets[0].vary_split).toBe(true)
    expect(doublets[0].vary_area_ratio).toBeUndefined()
  })

  it('preserves input order across mixed single/doublet interleaving', () => {
    const { peaks, doublets } = buildXpsSpecs(
      [
        singleDef({ id: '1', label: 'A' }),
        doubletDef({ id: '2', label: 'B' }),
        singleDef({ id: '3', label: 'C' }),
        doubletDef({ id: '4', label: 'D' }),
      ],
      { defaultVoigtEta: 0.5 },
    )
    expect(peaks.map((p) => p.name)).toEqual(['A', 'C'])
    expect(doublets.map((d) => d.base_name)).toEqual(['B', 'D'])
  })
})
