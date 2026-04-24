import { describe, expect, it } from 'vitest'
import type { XrdAnalysisPayload } from '../../types/artifact'
import { xrdAnalysisToInitialState } from './xrd-analysis-state'

describe('xrdAnalysisToInitialState', () => {
  it('seeds selected candidates and refinement bounds from an analysis snapshot', () => {
    const payload: XrdAnalysisPayload = {
      query: {
        range: [12, 78],
        method: 'approximate-fit',
      },
      experimentalPattern: {
        x: [10, 20, 30],
        y: [100, 80, 40],
        xLabel: '2theta',
        yLabel: 'Intensity',
      },
      phases: [
        {
          id: 'ph_1',
          name: 'Quartz',
          formula: 'SiO2',
          spaceGroup: 'P3121',
          cifRef: 'mp-7000',
          confidence: 0.92,
          weightFraction: 0.63,
          matchedPeaks: [],
        },
        {
          id: 'ph_2',
          name: 'Cristobalite',
          formula: 'SiO2',
          spaceGroup: 'Fd-3m',
          cifRef: 'mp-6945',
          confidence: 0.61,
          weightFraction: 0.37,
          matchedPeaks: [],
        },
      ],
      rietveld: {
        rwp: 8.4,
        gof: 1.7,
        converged: true,
      },
    }

    const seeded = xrdAnalysisToInitialState(payload)

    expect(seeded.params?.refinement?.twoThetaMin).toBe(12)
    expect(seeded.params?.refinement?.twoThetaMax).toBe(78)
    expect(seeded.candidates).toEqual([
      expect.objectContaining({
        material_id: 'mp-7000',
        name: 'Quartz',
        formula: 'SiO2',
        selected: true,
        weight_pct: 63,
      }),
      expect.objectContaining({
        material_id: 'mp-6945',
        name: 'Cristobalite',
        formula: 'SiO2',
        selected: true,
        weight_pct: 37,
      }),
    ])
    expect(seeded.refineResult).toEqual(
      expect.objectContaining({
        rwp: 8.4,
        gof: 1.7,
        converged: true,
      }),
    )
    expect(seeded.refineResult?.phases).toEqual([
      expect.objectContaining({
        phase_name: 'Quartz',
        formula: 'SiO2',
        hermann_mauguin: 'P3121',
        weight_pct: 63,
      }),
      expect.objectContaining({
        phase_name: 'Cristobalite',
        formula: 'SiO2',
        hermann_mauguin: 'Fd-3m',
        weight_pct: 37,
      }),
    ])
  })

  it('leaves refineResult empty for a search-only snapshot', () => {
    const payload: XrdAnalysisPayload = {
      query: {
        range: [5, 90],
        method: 'peak-match',
      },
      experimentalPattern: {
        x: [10, 20],
        y: [5, 3],
        xLabel: '2theta',
        yLabel: 'Intensity',
      },
      phases: [
        {
          id: 'cand_1',
          name: 'Hematite',
          formula: 'Fe2O3',
          spaceGroup: 'R-3c',
          cifRef: 'mp-19770',
          confidence: 0.88,
          weightFraction: null,
          matchedPeaks: [],
        },
      ],
      rietveld: null,
    }

    const seeded = xrdAnalysisToInitialState(payload)

    expect(seeded.refineResult).toBeNull()
    expect(seeded.candidates).toEqual([
      expect.objectContaining({
        material_id: 'mp-19770',
        name: 'Hematite',
        selected: true,
      }),
    ])
  })
})
