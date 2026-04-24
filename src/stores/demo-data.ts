import type { PeakFitPayload, SpectrumPayload } from '../types/artifact'

function generateXrdPattern(): SpectrumPayload & { file: string } {
  const x: number[] = []
  const y: number[] = []

  for (let angle = 10; angle <= 90; angle += 0.02) {
    x.push(angle)
    const bg = 50 + 20 * Math.exp(-0.01 * (angle - 10))
    const noise = (Math.random() - 0.5) * 8
    y.push(bg + noise)
  }

  const peaks = [
    { pos: 22.2, intensity: 850, width: 0.15 },
    { pos: 31.5, intensity: 2200, width: 0.18 },
    { pos: 38.9, intensity: 600, width: 0.16 },
    { pos: 45.3, intensity: 1800, width: 0.20 },
    { pos: 50.9, intensity: 350, width: 0.17 },
    { pos: 56.2, intensity: 1400, width: 0.22 },
    { pos: 65.8, intensity: 900, width: 0.25 },
    { pos: 70.4, intensity: 300, width: 0.20 },
    { pos: 74.8, intensity: 550, width: 0.24 },
    { pos: 79.4, intensity: 700, width: 0.28 },
  ]

  for (const peak of peaks) {
    for (let i = 0; i < x.length; i++) {
      const dx = x[i] - peak.pos
      const lorentz = peak.intensity / (1 + (2 * dx / peak.width) ** 2)
      const gauss =
        peak.intensity * Math.exp(-4 * Math.LN2 * (dx / peak.width) ** 2)
      y[i] += 0.5 * lorentz + 0.5 * gauss
    }
  }

  return {
    x,
    y,
    xLabel: '2θ (°)',
    yLabel: 'Intensity (a.u.)',
    spectrumType: 'XRD',
    processingChain: [],
    file: 'BaTiO3_xrd.xy',
  }
}

export const DEMO_SPECTRUM = generateXrdPattern()

export const DEMO_PEAK_FIT: PeakFitPayload = {
  spectrumId: null,
  algorithm: 'demo',
  peaks: [
    { index: 0, position: 22.2, intensity: 850, fwhm: 0.15, area: 145, snr: 42, label: '(100)' },
    { index: 1, position: 31.5, intensity: 2200, fwhm: 0.18, area: 450, snr: 110, label: '(110)' },
    { index: 2, position: 38.9, intensity: 600, fwhm: 0.16, area: 109, snr: 30, label: '(111)' },
    { index: 3, position: 45.3, intensity: 1800, fwhm: 0.20, area: 410, snr: 90, label: '(200)' },
    { index: 4, position: 50.9, intensity: 350, fwhm: 0.17, area: 68, snr: 17, label: '(210)' },
    { index: 5, position: 56.2, intensity: 1400, fwhm: 0.22, area: 350, snr: 70, label: '(211)' },
    { index: 6, position: 65.8, intensity: 900, fwhm: 0.25, area: 256, snr: 45, label: '(220)' },
    { index: 7, position: 70.4, intensity: 300, fwhm: 0.20, area: 68, snr: 15, label: '(300)' },
    { index: 8, position: 74.8, intensity: 550, fwhm: 0.24, area: 150, snr: 27, label: '(310)' },
    { index: 9, position: 79.4, intensity: 700, fwhm: 0.28, area: 223, snr: 35, label: '(311)' },
  ],
}
