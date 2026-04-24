// Client-side Levenberg-Marquardt fit of a single pseudo-Voigt peak.
//
// Input: windowed (x, y) data centred on a candidate peak + an initial
// guess for amplitude / center / fwhm / eta. Output: refined parameters
// + goodness-of-fit statistics.
//
// Why pure JS instead of round-tripping to the Python worker:
//   • Single-peak fit is a ~50-point × 4-parameter problem — fits in
//     under 1 ms in JS, faster than IPC latency to the worker.
//   • Keeps the XRD peak-profile modal self-contained so it works in
//     plain Vite mode too (no backend required).
//   • The worker's `xps.fit` assumes XPS semantics (Shirley/linear bg,
//     energy axis) which don't fit the XRD single-peak use case cleanly.
//
// For many-peak / whole-pattern fits the worker remains the right call
// — see `worker/tools/xps.py`. This solver is scoped to the peak-
// profile modal's "click a row → refine one peak" flow.

export interface PseudoVoigtParams {
  amplitude: number
  center: number
  fwhm: number
  /** Pseudo-Voigt Gaussian/Lorentzian mixing fraction: 0 = pure Gaussian,
   *  1 = pure Lorentzian. */
  eta: number
}

export interface PseudoVoigtFitOptions {
  /** Maximum LM iterations before giving up. Default 100 — a cleanly-
   *  separable single peak typically converges in <20. */
  maxIter?: number
  /** Convergence threshold on the relative χ² improvement between
   *  successive accepted steps. Default 1e-6. */
  tol?: number
  /** Bounds for each parameter in canonical order
   *  [amplitude, center, fwhm, eta]. Any entry may be `undefined` for an
   *  unbounded axis; defaults keep amplitude ≥ 0, fwhm ≥ 1e-4, eta in
   *  [0, 1], and center unconstrained. */
  bounds?: {
    amplitudeMin?: number
    amplitudeMax?: number
    centerMin?: number
    centerMax?: number
    fwhmMin?: number
    fwhmMax?: number
    etaMin?: number
    etaMax?: number
  }
}

export interface PseudoVoigtFitResult {
  params: PseudoVoigtParams
  /** Residual sum of squares of the final fit (Σ (y - ŷ)²). */
  rss: number
  /** Coefficient of determination R². `null` if the variance of y is 0. */
  rSquared: number | null
  /** Per-parameter standard error from (JᵀJ)⁻¹ × σ². May be `null` when
   *  the Jacobian is effectively rank-deficient. */
  paramErrors: PseudoVoigtParams | null
  /** Number of LM iterations performed (regardless of acceptance). */
  iterations: number
  converged: boolean
  /** True if the fit hit max iterations without converging. */
  maxIterReached: boolean
}

/** Peak-height-normalised pseudo-Voigt at a single x. */
export function pseudoVoigtAt(x: number, p: PseudoVoigtParams): number {
  if (p.fwhm <= 0) return 0
  const dx = (x - p.center) / p.fwhm
  const sq = 4 * dx * dx
  const g = Math.exp(-Math.LN2 * sq) // Gaussian
  const l = 1 / (1 + sq) // Lorentzian
  const eta = Math.max(0, Math.min(1, p.eta))
  return p.amplitude * ((1 - eta) * g + eta * l)
}

/** Bulk-evaluate the model over an x-array. */
export function pseudoVoigtCurve(
  x: readonly number[],
  p: PseudoVoigtParams,
): number[] {
  const out = new Array<number>(x.length)
  for (let i = 0; i < x.length; i++) out[i] = pseudoVoigtAt(x[i], p)
  return out
}

/** Clamp a parameter vector into a bounding box (in canonical order). */
function clampParams(
  p: PseudoVoigtParams,
  bounds: Required<NonNullable<PseudoVoigtFitOptions['bounds']>>,
): PseudoVoigtParams {
  return {
    amplitude: Math.max(bounds.amplitudeMin, Math.min(bounds.amplitudeMax, p.amplitude)),
    center: Math.max(bounds.centerMin, Math.min(bounds.centerMax, p.center)),
    fwhm: Math.max(bounds.fwhmMin, Math.min(bounds.fwhmMax, p.fwhm)),
    eta: Math.max(bounds.etaMin, Math.min(bounds.etaMax, p.eta)),
  }
}

function paramVec(p: PseudoVoigtParams): [number, number, number, number] {
  return [p.amplitude, p.center, p.fwhm, p.eta]
}

function paramFromVec(v: readonly number[]): PseudoVoigtParams {
  return { amplitude: v[0], center: v[1], fwhm: v[2], eta: v[3] }
}

function rssOf(x: readonly number[], y: readonly number[], p: PseudoVoigtParams): number {
  let s = 0
  for (let i = 0; i < x.length; i++) {
    const r = y[i] - pseudoVoigtAt(x[i], p)
    s += r * r
  }
  return s
}

/**
 * Solve a 4×4 symmetric positive-semidefinite linear system A·x = b via
 * Gaussian elimination with partial pivoting. Returns `null` when the
 * matrix is singular (caller should bail out — the LM step won't help).
 */
function solve4x4(A: number[][], b: number[]): number[] | null {
  // Copy into an augmented matrix so we don't mutate the caller's data.
  const M: number[][] = [
    [A[0][0], A[0][1], A[0][2], A[0][3], b[0]],
    [A[1][0], A[1][1], A[1][2], A[1][3], b[1]],
    [A[2][0], A[2][1], A[2][2], A[2][3], b[2]],
    [A[3][0], A[3][1], A[3][2], A[3][3], b[3]],
  ]
  for (let col = 0; col < 4; col++) {
    // Pivot
    let pivotRow = col
    let pivotAbs = Math.abs(M[col][col])
    for (let r = col + 1; r < 4; r++) {
      const a = Math.abs(M[r][col])
      if (a > pivotAbs) {
        pivotAbs = a
        pivotRow = r
      }
    }
    if (pivotAbs < 1e-14) return null
    if (pivotRow !== col) [M[col], M[pivotRow]] = [M[pivotRow], M[col]]
    // Eliminate below
    for (let r = col + 1; r < 4; r++) {
      const f = M[r][col] / M[col][col]
      for (let c = col; c < 5; c++) M[r][c] -= f * M[col][c]
    }
  }
  // Back-substitute
  const out = new Array<number>(4)
  for (let r = 3; r >= 0; r--) {
    let s = M[r][4]
    for (let c = r + 1; c < 4; c++) s -= M[r][c] * out[c]
    out[r] = s / M[r][r]
  }
  return out
}

/**
 * Forward-difference Jacobian of the pseudo-Voigt model at parameter
 * vector `p`, evaluated on sample grid `x`. Step size scales with each
 * parameter's magnitude (min 1e-6) to stay inside the finite-precision
 * sweet spot. Also returns the unperturbed model curve so the caller
 * can compute residuals without recomputing the evaluation.
 */
function finiteDifferenceJacobian(
  x: readonly number[],
  p: PseudoVoigtParams,
): { J: number[][]; yModel: number[] } {
  const n = x.length
  const pv = paramVec(p)
  const J: number[][] = Array.from(
    { length: n },
    () => new Array(4).fill(0),
  )
  const h = pv.map((v) => Math.max(Math.abs(v) * 1e-5, 1e-6))
  const yModel = pseudoVoigtCurve(x, p)
  for (let k = 0; k < 4; k++) {
    const pPlus = pv.slice()
    pPlus[k] += h[k]
    const yPlus = pseudoVoigtCurve(x, paramFromVec(pPlus))
    for (let i = 0; i < n; i++) J[i][k] = (yPlus[i] - yModel[i]) / h[k]
  }
  return { J, yModel }
}

const DEFAULT_BOUNDS: Required<NonNullable<PseudoVoigtFitOptions['bounds']>> = {
  amplitudeMin: 0,
  amplitudeMax: Number.POSITIVE_INFINITY,
  centerMin: Number.NEGATIVE_INFINITY,
  centerMax: Number.POSITIVE_INFINITY,
  fwhmMin: 1e-4,
  fwhmMax: Number.POSITIVE_INFINITY,
  etaMin: 0,
  etaMax: 1,
}

/**
 * Fit a single pseudo-Voigt peak to (x, y) data via Levenberg-Marquardt.
 * Uses finite-difference Jacobian (step = 1e-5 × |p| + 1e-6) and a
 * damping factor that adapts on each iteration (×10 after a rejected
 * step, ÷10 after an accepted one) — the textbook recipe.
 */
export function fitPseudoVoigt(
  x: readonly number[],
  y: readonly number[],
  seed: PseudoVoigtParams,
  opts: PseudoVoigtFitOptions = {},
): PseudoVoigtFitResult {
  if (x.length !== y.length) {
    throw new Error(`x and y must have same length (got ${x.length} vs ${y.length})`)
  }
  const n = x.length
  const maxIter = opts.maxIter ?? 100
  const tol = opts.tol ?? 1e-6
  const bounds = { ...DEFAULT_BOUNDS, ...opts.bounds }

  let p = clampParams(seed, bounds)
  let rss = rssOf(x, y, p)
  let lambda = 1e-3
  let iters = 0
  let converged = false

  while (iters < maxIter) {
    iters++
    const { J, yModel } = finiteDifferenceJacobian(x, p)
    // JᵀJ and Jᵀr
    const JtJ: number[][] = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]
    const Jtr = [0, 0, 0, 0]
    for (let i = 0; i < n; i++) {
      const ri = y[i] - yModel[i]
      for (let a = 0; a < 4; a++) {
        Jtr[a] += J[i][a] * ri
        for (let b = 0; b < 4; b++) JtJ[a][b] += J[i][a] * J[i][b]
      }
    }
    // Add LM damping to the diagonal.
    const A: number[][] = JtJ.map((row, i) => {
      const out = row.slice()
      out[i] += lambda * JtJ[i][i] + 1e-12 // small ridge to avoid singular
      return out
    })
    const delta = solve4x4(A, Jtr)
    if (!delta) {
      // Jacobian singular — bail out and return current best.
      break
    }
    const pv = paramVec(p)
    const trial = clampParams(
      paramFromVec([pv[0] + delta[0], pv[1] + delta[1], pv[2] + delta[2], pv[3] + delta[3]]),
      bounds,
    )
    const trialRss = rssOf(x, y, trial)
    if (trialRss < rss) {
      const rel = (rss - trialRss) / Math.max(rss, 1e-12)
      p = trial
      rss = trialRss
      lambda = Math.max(lambda / 10, 1e-12)
      if (rel < tol) {
        converged = true
        break
      }
    } else {
      lambda = Math.min(lambda * 10, 1e10)
      // Give up if damping blew up without making progress.
      if (lambda >= 1e10) break
    }
  }

  // Goodness of fit
  let meanY = 0
  for (let i = 0; i < n; i++) meanY += y[i]
  meanY /= n
  let ssTot = 0
  for (let i = 0; i < n; i++) ssTot += (y[i] - meanY) * (y[i] - meanY)
  const rSquared = ssTot > 0 ? 1 - rss / ssTot : null

  // Parameter errors from (JᵀJ)⁻¹ × σ² — rebuild the Jacobian at the
  // final p. Covariance is only well-defined when n > params.
  let paramErrors: PseudoVoigtParams | null = null
  if (n > 4) {
    const { J: J2 } = finiteDifferenceJacobian(x, p)
    const JtJ2: number[][] = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]
    for (let i = 0; i < n; i++) {
      for (let a = 0; a < 4; a++) {
        for (let b = 0; b < 4; b++) JtJ2[a][b] += J2[i][a] * J2[i][b]
      }
    }
    const sigmaSq = rss / (n - 4)
    // Invert via 4 linear solves against the identity columns.
    const cols: number[][] = []
    for (let c = 0; c < 4; c++) {
      const e = [0, 0, 0, 0]
      e[c] = 1
      const sol = solve4x4(JtJ2, e)
      if (!sol) {
        cols.length = 0
        break
      }
      cols.push(sol)
    }
    if (cols.length === 4) {
      paramErrors = {
        amplitude: Math.sqrt(Math.max(cols[0][0] * sigmaSq, 0)),
        center: Math.sqrt(Math.max(cols[1][1] * sigmaSq, 0)),
        fwhm: Math.sqrt(Math.max(cols[2][2] * sigmaSq, 0)),
        eta: Math.sqrt(Math.max(cols[3][3] * sigmaSq, 0)),
      }
    }
  }

  return {
    params: p,
    rss,
    rSquared,
    paramErrors,
    iterations: iters,
    converged,
    maxIterReached: iters >= maxIter && !converged,
  }
}
