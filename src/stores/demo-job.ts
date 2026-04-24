type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
type JobBackend = 'cp2k' | 'vasp' | 'lammps' | 'ase' | 'qe' | 'abinit'

interface JobConvergencePoint {
  iter: number
  metric: string
  value: number
}

interface JobLogLine {
  ts: number
  level: 'info' | 'warn' | 'error' | 'debug'
  text: string
}

interface JobMonitorPayload {
  jobId: string
  jobName: string
  backend: JobBackend
  command: string
  status: JobStatus
  progress: number
  startedAt: number
  endedAt: number | null
  convergence: JobConvergencePoint[]
  log: JobLogLine[]
  resultArtifactIds: string[]
  resources?: {
    cpuHours?: number
    memGb?: number
    nodes?: number
  }
}

const TOTAL_ITERATIONS = 62
const DURATION_MS = 15 * 60 * 1000

// Deterministic pseudo-random generator so the demo stays stable across reloads.
function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

function buildConvergence(): JobConvergencePoint[] {
  const points: JobConvergencePoint[] = []
  const energyStart = -3200.0
  const energyEnd = -3245.8
  const forceStart = 0.05
  const forceEnd = 0.002
  for (let i = 0; i < TOTAL_ITERATIONS; i++) {
    const progress = i / (TOTAL_ITERATIONS - 1)
    // Smooth monotonic ease-out for energy, with small noise that decays.
    const easedE = 1 - Math.pow(1 - progress, 1.7)
    const noiseE = (pseudoRandom(i + 1) - 0.5) * 0.9 * (1 - easedE)
    const energy = energyStart + (energyEnd - energyStart) * easedE + noiseE
    points.push({
      iter: i,
      metric: 'total_energy',
      value: +energy.toFixed(4),
    })

    // Exponential decay for max force, keep strictly positive.
    const easedF = Math.pow(1 - progress, 2.2)
    const noiseF = (pseudoRandom(i + 101) - 0.5) * 0.0025 * easedF
    const force = Math.max(
      forceEnd * 0.6,
      forceEnd + (forceStart - forceEnd) * easedF + noiseF,
    )
    points.push({
      iter: i,
      metric: 'max_force',
      value: +force.toFixed(5),
    })
  }
  return points
}

interface LogTemplate {
  level: JobLogLine['level']
  text: string
}

const LOG_TEMPLATES: LogTemplate[] = [
  { level: 'info', text: 'CP2K 2024.1 starting on 4 MPI ranks x 16 OMP threads' },
  { level: 'info', text: 'Reading input file: BaTiO3_opt.inp' },
  { level: 'info', text: 'GLOBAL| Run type GEO_OPT' },
  { level: 'info', text: 'DFT| Exchange-correlation functional PBE' },
  { level: 'info', text: 'Loaded basis set DZVP-MOLOPT-SR-GTH for Ba, Ti, O' },
  { level: 'warn', text: 'WARNING: Basis set DZVP-MOLOPT-SR-GTH may be insufficient for heavy atoms' },
  { level: 'info', text: 'CELL| Volume [angstrom^3]:      64.7321' },
  { level: 'info', text: 'Initial guess: ATOMIC density superposition' },
  { level: 'info', text: 'Step     1: SCF run converged in 32 steps' },
  { level: 'info', text: 'Step     1: Total energy =   -3200.0123 Ha' },
  { level: 'info', text: 'Step     1: Max force    =    5.0123e-02 Ha/Bohr' },
  { level: 'info', text: 'Step     5: SCF run converged in 28 steps' },
  { level: 'info', text: 'Step    10: SCF run converged in 24 steps' },
  { level: 'warn', text: 'WARNING: SCF density difference above threshold on step 11' },
  { level: 'info', text: 'Step    15: SCF run converged in 22 steps' },
  { level: 'info', text: 'Step    20: SCF run converged in 21 steps' },
  { level: 'info', text: 'Step    20: Total energy =   -3228.6411 Ha' },
  { level: 'info', text: 'BFGS optimizer: predicted energy change -1.8e-03 Ha' },
  { level: 'info', text: 'Step    25: SCF run converged in 20 steps' },
  { level: 'info', text: 'Step    30: SCF run converged in 19 steps' },
  { level: 'info', text: 'Step    30: Max force    =    8.7e-03 Ha/Bohr' },
  { level: 'warn', text: 'WARNING: cell angles drifting from target by > 0.15 deg' },
  { level: 'info', text: 'Step    35: SCF run converged in 19 steps' },
  { level: 'info', text: 'Step    40: SCF run converged in 18 steps' },
  { level: 'info', text: 'Step    40: Total energy =   -3241.2219 Ha' },
  { level: 'info', text: 'BFGS optimizer: updating Hessian, rank-2 correction' },
  { level: 'info', text: 'Step    45: SCF run converged in 18 steps' },
  { level: 'info', text: 'Step    50: SCF run converged in 17 steps' },
  { level: 'info', text: 'Step    55: SCF run converged in 17 steps' },
  { level: 'info', text: 'Step    60: Optimization proceeding, progress 97%' },
]

function buildLog(startedAt: number): JobLogLine[] {
  const n = LOG_TEMPLATES.length
  return LOG_TEMPLATES.map((t, i) => {
    const offset = Math.floor(((i + 1) / (n + 1)) * DURATION_MS)
    return { ts: startedAt + offset, level: t.level, text: t.text }
  })
}

function buildPayload(): JobMonitorPayload {
  const startedAt = Date.now() - DURATION_MS
  return {
    jobId: 'cp2k-20260410-175432',
    jobName: 'BaTiO3 geometry optimization',
    backend: 'cp2k',
    command: 'cp2k.psmp -i BaTiO3_opt.inp -o BaTiO3_opt.out',
    status: 'running',
    progress: 0.62,
    startedAt,
    endedAt: null,
    convergence: buildConvergence(),
    log: buildLog(startedAt),
    resultArtifactIds: [],
    resources: { cpuHours: 12.5, memGb: 48, nodes: 4 },
  }
}

export const DEMO_JOB_MONITOR: JobMonitorPayload = buildPayload()
