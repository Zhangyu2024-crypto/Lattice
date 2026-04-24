interface OptObjective {
  name: string
  direction: 'minimize' | 'maximize'
  unit?: string
}

interface OptParameter {
  name: string
  type: 'continuous' | 'discrete'
  low: number
  high: number
  unit?: string
}

interface OptTrial {
  id: string
  iter: number
  params: Record<string, number>
  objective: number
  timestamp: number
  status: 'pending' | 'completed' | 'failed'
}

interface OptNextCandidate {
  params: Record<string, number>
  expectedObjective: number
  uncertainty: number
}

interface OptimizationPayload {
  strategy: 'bayesian' | 'grid' | 'random'
  objective: OptObjective
  parameters: OptParameter[]
  trials: OptTrial[]
  currentBest: OptTrial | null
  nextCandidates: OptNextCandidate[]
  status: 'running' | 'converged' | 'paused'
}

const TRIAL_COUNT = 24
const FAILED_TRIAL_ITER = 11
const PENDING_TRIAL_ITER = 23
const NOW = Date.now()
const ITER_INTERVAL_MS = 3 * 60 * 1000

// Deterministic noise so the demo is stable across reloads.
function hashNoise(seed: number): number {
  const x = Math.sin(seed * 13.7317 + 1.1) * 43758.5453
  return x - Math.floor(x) - 0.5
}

// Smooth convergence: lerp from start to target along an ease-out curve,
// then add a decaying noise envelope so later trials look tighter.
function objectiveAt(iter: number): number {
  const progress = iter / (TRIAL_COUNT - 1)
  const eased = 1 - Math.pow(1 - progress, 2.1)
  const target = 2.8 + (3.6 - 2.8) * eased
  const noise = hashNoise(iter + 7) * 0.18 * (1 - eased * 0.85)
  return +(target + noise).toFixed(4)
}

function paramsAt(iter: number): Record<string, number> {
  const n = TRIAL_COUNT - 1
  // Bayesian-style convergence toward an optimum near ~4% Fe, ~820C, ~110nm.
  const Fe = 1.5 + hashNoise(iter * 3 + 5) * 3.5 * (1 - iter / n) + (iter / n) * 2.5
  const T = 650 + hashNoise(iter * 5 + 9) * 180 * (1 - iter / n) + (iter / n) * 170
  const grain = 40 + hashNoise(iter * 7 + 13) * 120 * (1 - iter / n) + (iter / n) * 70
  return {
    Fe_dopant_pct: +Fe.toFixed(2),
    calcination_T_C: +T.toFixed(0),
    grain_size_nm: +grain.toFixed(0),
  }
}

function buildTrials(): OptTrial[] {
  const trials: OptTrial[] = []
  for (let i = 0; i < TRIAL_COUNT; i++) {
    const status: OptTrial['status'] =
      i === PENDING_TRIAL_ITER
        ? 'pending'
        : i === FAILED_TRIAL_ITER
          ? 'failed'
          : 'completed'
    trials.push({
      id: `trial-${i.toString().padStart(3, '0')}`,
      iter: i,
      params: paramsAt(i),
      objective:
        status === 'pending'
          ? 0
          : status === 'failed'
            ? Number.NaN
            : objectiveAt(i),
      timestamp: NOW - (TRIAL_COUNT - i) * ITER_INTERVAL_MS,
      status,
    })
  }
  return trials
}

function selectBest(trials: OptTrial[]): OptTrial | null {
  let best: OptTrial | null = null
  for (const t of trials) {
    if (t.status !== 'completed') continue
    if (!Number.isFinite(t.objective)) continue
    if (!best || t.objective > best.objective) best = t
  }
  return best
}

function buildCandidates(): OptNextCandidate[] {
  const bases: Array<{ p: Record<string, number>; exp: number; unc: number }> = [
    { p: { Fe_dopant_pct: 4.1, calcination_T_C: 820, grain_size_nm: 112 }, exp: 3.58, unc: 0.04 },
    { p: { Fe_dopant_pct: 3.7, calcination_T_C: 840, grain_size_nm: 96 }, exp: 3.56, unc: 0.05 },
    { p: { Fe_dopant_pct: 4.6, calcination_T_C: 805, grain_size_nm: 124 }, exp: 3.54, unc: 0.06 },
    { p: { Fe_dopant_pct: 3.2, calcination_T_C: 865, grain_size_nm: 88 }, exp: 3.51, unc: 0.08 },
    { p: { Fe_dopant_pct: 5.0, calcination_T_C: 780, grain_size_nm: 140 }, exp: 3.48, unc: 0.11 },
  ]
  return bases.map((b) => ({
    params: b.p,
    expectedObjective: b.exp,
    uncertainty: b.unc,
  }))
}

const TRIALS = buildTrials()
const CURRENT_BEST = selectBest(TRIALS)

export const DEMO_OPTIMIZATION: OptimizationPayload = {
  strategy: 'bayesian',
  objective: {
    name: 'band_gap',
    direction: 'maximize',
    unit: 'eV',
  },
  parameters: [
    { name: 'Fe_dopant_pct', type: 'continuous', low: 0, high: 10, unit: '%' },
    { name: 'calcination_T_C', type: 'continuous', low: 600, high: 1000, unit: '°C' },
    { name: 'grain_size_nm', type: 'continuous', low: 20, high: 200, unit: 'nm' },
  ],
  trials: TRIALS,
  currentBest: CURRENT_BEST,
  nextCandidates: buildCandidates(),
  status: 'running',
}
