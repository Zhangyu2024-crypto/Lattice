import { describe, expect, it } from 'vitest'

import { buildSpectrumChartOption } from './pro-chart'

describe('buildSpectrumChartOption', () => {
  it('renders overlays above the observed spectrum series', () => {
    const option = buildSpectrumChartOption({
      spectrum: {
        x: [10, 20],
        y: [100, 80],
        xLabel: '2θ (°)',
        yLabel: 'Intensity',
        spectrumType: 'Observed',
      },
      overlays: [
        {
          name: 'Calculated',
          x: [10, 20],
          y: [98, 82],
          color: '#999',
        },
      ],
    }) as { series: Array<{ name?: string; z?: number }> }

    const observed = option.series.find((s) => s.name === 'Observed')
    const calculated = option.series.find((s) => s.name === 'Calculated')

    expect(observed?.z).toBe(2)
    expect(calculated?.z).toBeGreaterThan(observed?.z ?? 0)
  })
})
