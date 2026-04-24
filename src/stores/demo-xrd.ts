interface XrdAnalysisPayload {
  query: {
    range: [number, number]
    method: 'peak-match' | 'rietveld' | 'approximate-fit'
  }
  experimentalPattern: { x: number[]; y: number[]; xLabel: string; yLabel: string }
  phases: Array<{
    id: string
    name: string
    formula: string
    spaceGroup: string
    cifRef: string | null
    confidence: number
    weightFraction: number | null
    matchedPeaks: Array<{
      position: number
      hkl: string
      intensity_obs: number
      intensity_calc: number
    }>
    theoreticalPattern?: { x: number[]; y: number[] }
  }>
  rietveld: {
    rwp: number
    gof: number
    converged: boolean
  } | null
}

interface PeakSpec {
  pos: number
  hkl: string
  intensity: number
  width: number
}

const BATIO3_PEAKS: PeakSpec[] = [
  { pos: 22.2, hkl: '(100)', intensity: 850, width: 0.18 },
  { pos: 31.5, hkl: '(110)', intensity: 2200, width: 0.20 },
  { pos: 38.9, hkl: '(111)', intensity: 600, width: 0.20 },
  { pos: 45.3, hkl: '(200)', intensity: 1800, width: 0.22 },
  { pos: 50.9, hkl: '(210)', intensity: 350, width: 0.22 },
  { pos: 56.2, hkl: '(211)', intensity: 1400, width: 0.24 },
]

const TIO2_PEAKS: PeakSpec[] = [
  { pos: 25.3, hkl: '(101)', intensity: 900, width: 0.20 },
  { pos: 37.8, hkl: '(004)', intensity: 260, width: 0.22 },
  { pos: 48.0, hkl: '(200)', intensity: 340, width: 0.22 },
  { pos: 53.9, hkl: '(105)', intensity: 200, width: 0.23 },
  { pos: 62.7, hkl: '(204)', intensity: 180, width: 0.25 },
]

function makeGrid(): number[] {
  const x: number[] = []
  for (let a = 10; a <= 80; a += 0.02) x.push(+a.toFixed(2))
  return x
}

function pseudoVoigt(dx: number, width: number, intensity: number): number {
  const lor = intensity / (1 + (2 * dx / width) ** 2)
  const gau = intensity * Math.exp(-4 * Math.LN2 * (dx / width) ** 2)
  return 0.5 * lor + 0.5 * gau
}

function addPeaks(x: number[], y: number[], peaks: PeakSpec[], scale: number) {
  for (const p of peaks) {
    for (let i = 0; i < x.length; i++) {
      const dx = x[i] - p.pos
      if (Math.abs(dx) > 2) continue
      y[i] += pseudoVoigt(dx, p.width, p.intensity * scale)
    }
  }
}

function buildPhasePattern(x: number[], peaks: PeakSpec[]): number[] {
  const y = new Array<number>(x.length).fill(0)
  addPeaks(x, y, peaks, 1)
  return y
}

function buildExperimentalPattern(x: number[]): number[] {
  const y = new Array<number>(x.length).fill(0)
  // Background: slow exponential decay + constant floor.
  for (let i = 0; i < x.length; i++) {
    y[i] = 55 + 30 * Math.exp(-0.02 * (x[i] - 10))
  }
  addPeaks(x, y, BATIO3_PEAKS, 0.78)
  addPeaks(x, y, TIO2_PEAKS, 0.22)
  // Deterministic pseudo-random noise so the demo is stable across reloads.
  for (let i = 0; i < x.length; i++) {
    const seed = Math.sin(i * 12.9898) * 43758.5453
    const rnd = seed - Math.floor(seed)
    y[i] += (rnd - 0.5) * 6
  }
  return y
}

function buildPayload(): XrdAnalysisPayload {
  const x = makeGrid()
  const expY = buildExperimentalPattern(x)
  const batioY = buildPhasePattern(x, BATIO3_PEAKS)
  const tio2Y = buildPhasePattern(x, TIO2_PEAKS)

  return {
    query: { range: [10, 80], method: 'rietveld' },
    experimentalPattern: {
      x,
      y: expY,
      xLabel: '2θ (°)',
      yLabel: 'Intensity (a.u.)',
    },
    phases: [
      {
        id: 'phase-batio3',
        name: 'Barium Titanate',
        formula: 'BaTiO3',
        spaceGroup: 'P4mm',
        cifRef: 'COD_1234567',
        confidence: 0.92,
        weightFraction: 0.78,
        matchedPeaks: BATIO3_PEAKS.map((p) => ({
          position: p.pos,
          hkl: p.hkl,
          intensity_obs: +(p.intensity * 0.78).toFixed(1),
          intensity_calc: +(p.intensity * 0.80).toFixed(1),
        })),
        theoreticalPattern: { x, y: batioY },
      },
      {
        id: 'phase-tio2',
        name: 'Titanium Dioxide (Anatase)',
        formula: 'TiO2',
        spaceGroup: 'I41/amd',
        cifRef: null,
        confidence: 0.74,
        weightFraction: 0.22,
        matchedPeaks: TIO2_PEAKS.map((p) => ({
          position: p.pos,
          hkl: p.hkl,
          intensity_obs: +(p.intensity * 0.22).toFixed(1),
          intensity_calc: +(p.intensity * 0.21).toFixed(1),
        })),
        theoreticalPattern: { x, y: tio2Y },
      },
    ],
    rietveld: { rwp: 8.2, gof: 1.45, converged: true },
  }
}

export const DEMO_XRD_ANALYSIS: XrdAnalysisPayload = buildPayload()
