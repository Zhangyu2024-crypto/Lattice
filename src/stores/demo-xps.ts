// Demo payload for the `xps-analysis` artifact kind.
// Produces pseudo-voigt fits over a simple sloped background with
// deterministic noise so the XpsAnalysisCard has something to render.

interface XpsPeak {
  label: string
  binding: number
  fwhm: number
  area: number
  assignment: string
}

interface XpsFit {
  element: string
  line: string
  bindingRange: [number, number]
  experimentalPattern: { x: number[]; y: number[] }
  modelPattern: { x: number[]; y: number[] }
  residuals: number[]
  peaks: XpsPeak[]
  background: 'shirley' | 'linear' | 'tougaard'
}

interface XpsQuantRow {
  element: string
  atomicPercent: number
  relativeSensitivity: number
}

interface XpsAnalysisPayload {
  fits: XpsFit[]
  quantification: XpsQuantRow[]
  chargeCorrection: {
    refElement: string
    refLine: string
    refBE: number
    observedBE: number
    shift: number
  } | null
  validation?: { flags: string[] }
}

interface PeakSpec {
  label: string
  center: number
  fwhm: number
  amplitude: number
  area: number
  assignment: string
}

function linspace(start: number, stop: number, step: number): number[] {
  const out: number[] = []
  for (let v = start; v <= stop + 1e-9; v += step) out.push(Number(v.toFixed(4)))
  return out
}

function pseudoVoigt(x: number, center: number, fwhm: number, amp: number): number {
  const sigma = fwhm / (2 * Math.sqrt(2 * Math.LN2))
  const gamma = fwhm / 2
  const d = x - center
  const gauss = Math.exp(-(d * d) / (2 * sigma * sigma))
  const lorentz = (gamma * gamma) / (d * d + gamma * gamma)
  return amp * (0.3 * lorentz + 0.7 * gauss)
}

function baseline(x: number, xMin: number, xMax: number, lo: number, hi: number): number {
  const t = (x - xMin) / (xMax - xMin)
  return lo + (hi - lo) * Math.min(1, Math.max(0, t))
}

// LCG seeded RNG keeps demo data stable across reloads.
function seededNoise(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return ((s & 0xffff) / 0xffff - 0.5) * 2
  }
}

function buildFit(
  element: string,
  line: string,
  range: [number, number],
  step: number,
  bgLow: number,
  bgHigh: number,
  specs: PeakSpec[],
  background: XpsFit['background'],
  noiseScale: number,
  seed: number,
): XpsFit {
  const x = linspace(range[0], range[1], step)
  const rand = seededNoise(seed)
  const modelY: number[] = []
  const expY: number[] = []
  const residuals: number[] = []

  for (let i = 0; i < x.length; i++) {
    let sum = 0
    for (const p of specs) sum += pseudoVoigt(x[i], p.center, p.fwhm, p.amplitude)
    const m = sum + baseline(x[i], range[0], range[1], bgLow, bgHigh)
    const e = m + rand() * noiseScale
    modelY.push(Number(m.toFixed(3)))
    expY.push(Number(e.toFixed(3)))
    residuals.push(Number((e - m).toFixed(3)))
  }

  return {
    element,
    line,
    bindingRange: range,
    experimentalPattern: { x, y: expY },
    modelPattern: { x, y: modelY },
    residuals,
    background,
    peaks: specs.map((p) => ({
      label: p.label,
      binding: p.center,
      fwhm: p.fwhm,
      area: p.area,
      assignment: p.assignment,
    })),
  }
}

const FE_2P = buildFit(
  'Fe',
  '2p',
  [700, 740],
  0.1,
  320,
  540,
  [
    { label: 'Fe2p3/2', center: 710.8, fwhm: 1.6, amplitude: 1850, area: 3155, assignment: 'Fe(III) oxide' },
    { label: 'Fe2p3/2 sh', center: 711.9, fwhm: 1.8, amplitude: 980, area: 1880, assignment: 'Fe(III) hydroxide' },
    { label: 'Fe2p sat', center: 719.0, fwhm: 3.2, amplitude: 420, area: 1435, assignment: 'Shake-up satellite' },
    { label: 'Fe2p1/2', center: 724.3, fwhm: 2.1, amplitude: 920, area: 2055, assignment: 'Fe(III) oxide' },
  ],
  'shirley',
  14,
  42,
)

const O_1S = buildFit(
  'O',
  '1s',
  [525, 540],
  0.05,
  180,
  260,
  [
    { label: 'O1s lattice', center: 530.2, fwhm: 1.2, amplitude: 3200, area: 4090, assignment: 'Lattice oxide' },
    { label: 'O1s OH', center: 531.8, fwhm: 1.5, amplitude: 1450, area: 2310, assignment: 'Hydroxide / defect' },
    { label: 'O1s H2O', center: 533.1, fwhm: 1.6, amplitude: 520, area: 885, assignment: 'Adsorbed H2O' },
  ],
  'shirley',
  12,
  7,
)

const C_1S = buildFit(
  'C',
  '1s',
  [280, 295],
  0.05,
  140,
  155,
  [
    { label: 'C1s C-C', center: 284.8, fwhm: 1.1, amplitude: 2600, area: 3050, assignment: 'Adventitious C-C / C-H' },
    { label: 'C1s C-O', center: 286.5, fwhm: 1.3, amplitude: 780, area: 1080, assignment: 'C-O / C-OH' },
    { label: 'C1s C=O', center: 288.8, fwhm: 1.4, amplitude: 430, area: 640, assignment: 'Carbonyl / O=C-O' },
  ],
  'linear',
  9,
  1337,
)

export const DEMO_XPS_ANALYSIS: XpsAnalysisPayload = {
  fits: [FE_2P, O_1S, C_1S],
  quantification: [
    { element: 'Fe', atomicPercent: 32.5, relativeSensitivity: 2.957 },
    { element: 'O', atomicPercent: 51.2, relativeSensitivity: 0.66 },
    { element: 'C', atomicPercent: 16.3, relativeSensitivity: 0.25 },
  ],
  chargeCorrection: {
    refElement: 'C',
    refLine: '1s',
    refBE: 284.8,
    observedBE: 284.8,
    shift: 0.0,
  },
  validation: undefined,
}
