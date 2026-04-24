import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./worker-client', () => ({
  callWorker: vi.fn(),
}))

import { localProXrd } from './local-pro-xrd'
import { callWorker } from './worker-client'

const mockCallWorker = vi.mocked(callWorker)

const SPECTRUM = {
  x: [10, 20],
  y: [100, 80],
  xLabel: '2θ (°)',
  yLabel: 'Intensity',
  spectrumType: 'xrd',
}

beforeEach(() => {
  mockCallWorker.mockReset()
})

describe('localProXrd.refineDara', () => {
  it('lifts nested DARA fitted_pattern curves to the top level', async () => {
    mockCallWorker.mockResolvedValue({
      ok: true,
      value: {
        success: true,
        data: {
          phases: [],
          rwp: 12.3,
          fitted_pattern: {
            x: [10, 20],
            y_obs: [100, 80],
            y_calc: [95, 75],
          },
        },
      },
      durationMs: 8,
    })

    const res = await localProXrd.refineDara(SPECTRUM, {
      cif_texts: [{ filename: 'demo.cif', content: 'data_demo' }],
    })

    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data.x).toEqual([10, 20])
    expect(res.data.y_obs).toEqual([100, 80])
    expect(res.data.y_calc).toEqual([95, 75])
    expect(res.data.y_diff).toEqual([5, 5])
  })
})
