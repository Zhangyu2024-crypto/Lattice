interface RamanMatch {
  id: string
  mineralName: string
  formula: string
  referenceSource: string
  rruffId?: string
  cosineScore: number
  referenceSpectrum: { x: number[]; y: number[] }
  keyPeaks: number[]
}

interface RamanIdPayload {
  experimentalSpectrum: {
    x: number[]
    y: number[]
    xLabel: string
    yLabel: string
  }
  query: { source: 'RRUFF' | 'user-db'; topN: number; hint: string | null }
  matches: RamanMatch[]
}

interface PeakSpec {
  pos: number
  intensity: number
  width: number
}

const X_MIN = 100
const X_MAX = 1800
const X_STEP = 1

function makeGrid(): number[] {
  const x: number[] = []
  for (let v = X_MIN; v <= X_MAX; v += X_STEP) x.push(v)
  return x
}

function pseudoVoigt(dx: number, width: number, intensity: number): number {
  const lor = intensity / (1 + (2 * dx / width) ** 2)
  const gau = intensity * Math.exp(-4 * Math.LN2 * (dx / width) ** 2)
  return 0.5 * lor + 0.5 * gau
}

function addPeaks(x: number[], y: number[], peaks: PeakSpec[]): void {
  for (const p of peaks) {
    for (let i = 0; i < x.length; i++) {
      const dx = x[i] - p.pos
      if (Math.abs(dx) > p.width * 8) continue
      y[i] += pseudoVoigt(dx, p.width, p.intensity)
    }
  }
}

function buildReference(x: number[], peaks: PeakSpec[]): number[] {
  const y = new Array<number>(x.length).fill(20)
  addPeaks(x, y, peaks)
  return y
}

function buildExperimental(x: number[], peaks: PeakSpec[]): number[] {
  const y = new Array<number>(x.length).fill(0)
  for (let i = 0; i < x.length; i++) {
    y[i] = 45 + 25 * Math.exp(-0.0015 * (x[i] - X_MIN))
  }
  addPeaks(x, y, peaks)
  for (let i = 0; i < x.length; i++) {
    const seed = Math.sin(i * 12.9898) * 43758.5453
    const rnd = seed - Math.floor(seed)
    y[i] += (rnd - 0.5) * 14
  }
  return y
}

const CALCITE_PEAKS: PeakSpec[] = [
  { pos: 155, intensity: 280, width: 6 },
  { pos: 282, intensity: 420, width: 7 },
  { pos: 713, intensity: 230, width: 7 },
  { pos: 1086, intensity: 1100, width: 8 },
]

const ARAGONITE_PEAKS: PeakSpec[] = [
  { pos: 152, intensity: 300, width: 7 },
  { pos: 206, intensity: 260, width: 7 },
  { pos: 702, intensity: 210, width: 8 },
  { pos: 1085, intensity: 980, width: 8 },
]

const DOLOMITE_PEAKS: PeakSpec[] = [
  { pos: 176, intensity: 260, width: 7 },
  { pos: 299, intensity: 380, width: 8 },
  { pos: 725, intensity: 200, width: 8 },
  { pos: 1098, intensity: 1050, width: 8 },
]

const VATERITE_PEAKS: PeakSpec[] = [
  { pos: 123, intensity: 220, width: 7 },
  { pos: 300, intensity: 310, width: 9 },
  { pos: 743, intensity: 170, width: 9 },
  { pos: 1075, intensity: 720, width: 10 },
  { pos: 1090, intensity: 680, width: 10 },
]

const QUARTZ_PEAKS: PeakSpec[] = [
  { pos: 128, intensity: 210, width: 6 },
  { pos: 206, intensity: 180, width: 7 },
  { pos: 355, intensity: 160, width: 7 },
  { pos: 464, intensity: 900, width: 7 },
  { pos: 808, intensity: 140, width: 8 },
]

function buildPayload(): RamanIdPayload {
  const x = makeGrid()
  return {
    experimentalSpectrum: {
      x,
      y: buildExperimental(x, CALCITE_PEAKS),
      xLabel: 'Raman shift (cm\u207B\u00B9)',
      yLabel: 'Intensity (a.u.)',
    },
    query: { source: 'RRUFF', topN: 5, hint: null },
    matches: [
      {
        id: 'match-calcite',
        mineralName: 'Calcite',
        formula: 'CaCO3',
        referenceSource: 'RRUFF',
        rruffId: 'R040070',
        cosineScore: 0.94,
        referenceSpectrum: { x, y: buildReference(x, CALCITE_PEAKS) },
        keyPeaks: [155, 282, 713, 1086],
      },
      {
        id: 'match-aragonite',
        mineralName: 'Aragonite',
        formula: 'CaCO3',
        referenceSource: 'RRUFF',
        rruffId: 'R040078',
        cosineScore: 0.81,
        referenceSpectrum: { x, y: buildReference(x, ARAGONITE_PEAKS) },
        keyPeaks: [152, 206, 702, 1085],
      },
      {
        id: 'match-dolomite',
        mineralName: 'Dolomite',
        formula: 'CaMg(CO3)2',
        referenceSource: 'RRUFF',
        rruffId: 'R040030',
        cosineScore: 0.72,
        referenceSpectrum: { x, y: buildReference(x, DOLOMITE_PEAKS) },
        keyPeaks: [176, 299, 725, 1098],
      },
      {
        id: 'match-vaterite',
        mineralName: 'Vaterite',
        formula: 'CaCO3',
        referenceSource: 'RRUFF',
        rruffId: 'R100062',
        cosineScore: 0.63,
        referenceSpectrum: { x, y: buildReference(x, VATERITE_PEAKS) },
        keyPeaks: [123, 300, 743, 1075, 1090],
      },
      {
        id: 'match-quartz',
        mineralName: 'Quartz',
        formula: 'SiO2',
        referenceSource: 'RRUFF',
        rruffId: 'R040031',
        cosineScore: 0.42,
        referenceSpectrum: { x, y: buildReference(x, QUARTZ_PEAKS) },
        keyPeaks: [128, 206, 355, 464, 808],
      },
    ],
  }
}

export const DEMO_RAMAN_ID: RamanIdPayload = buildPayload()
