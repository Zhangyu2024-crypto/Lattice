// Client-side synthesis of an XRD pattern from a reference peak list.
//
// Each reference peak (2θ, rel_intensity) is broadened with a
// pseudo-Voigt kernel of fixed FWHM and summed onto a dense sampling
// grid covering the spectrum's 2θ range. The result is a smooth curve
// roughly equivalent to what the worker's `xrd.predict` handler would
// emit for an internal-DB phase — we do it in the renderer because the
// `ref_peaks` data is already shipped in the search response (see
// Phase 4), so a Python round-trip would add latency with no fidelity
// gain for the table-driven phase set.
//
// For CIF-driven predictions (structure factor calculation, anisotropic
// effects) a real backend predictor is still warranted; flag that as a
// follow-up if a user asks for it.

export interface RefPeak {
  twoTheta: number
  relIntensity: number
}

export interface SynthOptions {
  /** Inclusive 2θ sampling range. Must include all reference peaks of
   *  interest; peaks outside the range are skipped. */
  twoThetaMin: number
  twoThetaMax: number
  /** Target number of sample points. Defaults to 2000 — dense enough
   *  that pseudo-Voigt kernels ≥ 0.05° FWHM resolve cleanly, while
   *  keeping ECharts render time trivial. */
  nPoints?: number
  /** Kernel FWHM in degrees 2θ. Defaults to 0.1° — typical lab
   *  diffractometer instrumental broadening. Callers that want the
   *  simulated pattern to match a specific instrument should pass the
   *  same value they use in the Scherrer section. */
  fwhmDeg?: number
  /** Pseudo-Voigt Gaussian/Lorentzian mixing fraction (0..1). Defaults
   *  to 0.5 — a compromise that looks right for most lab data. */
  eta?: number
  /** Scale factor applied to the summed pattern. The caller typically
   *  sets this to something like 0.9 × observed_y_max so the simulated
   *  curve lives at visibly-similar height to the observation without
   *  over-topping it. Defaults to 1. */
  scale?: number
}

/** Peak-height-normalised pseudo-Voigt kernel. */
function pseudoVoigt(
  x: number,
  center: number,
  fwhm: number,
  eta: number,
): number {
  if (fwhm <= 0) return 0
  // Gaussian part (peak height = 1):  exp(-4·ln2 · ((x-c)/fwhm)²)
  const dx = (x - center) / fwhm
  const g = Math.exp(-4 * Math.LN2 * dx * dx)
  // Lorentzian part (peak height = 1):  1 / (1 + 4·((x-c)/fwhm)²)
  const l = 1 / (1 + 4 * dx * dx)
  return (1 - eta) * g + eta * l
}

/**
 * Synthesize a continuous pattern by summing pseudo-Voigt kernels at
 * each reference peak's 2θ, weighted by rel_intensity (0..1). Returned
 * arrays always have `nPoints` length and share the same indices.
 */
export function synthesizePattern(
  refPeaks: readonly RefPeak[],
  opts: SynthOptions,
): { x: number[]; y: number[] } {
  const {
    twoThetaMin,
    twoThetaMax,
    nPoints = 2000,
    fwhmDeg = 0.1,
    eta = 0.5,
    scale = 1,
  } = opts
  if (
    twoThetaMax <= twoThetaMin ||
    nPoints < 2 ||
    !Number.isFinite(twoThetaMin) ||
    !Number.isFinite(twoThetaMax)
  ) {
    return { x: [], y: [] }
  }
  const step = (twoThetaMax - twoThetaMin) / (nPoints - 1)
  const x = new Array<number>(nPoints)
  const y = new Array<number>(nPoints).fill(0)
  for (let i = 0; i < nPoints; i++) x[i] = twoThetaMin + i * step

  // Limit per-peak evaluation to a window ±6 × FWHM for speed — the
  // pseudo-Voigt tail drops to ~0.3 % of peak height by then, below the
  // noise floor of any real spectrum.
  const window = 6 * fwhmDeg
  for (const p of refPeaks) {
    if (
      !Number.isFinite(p.twoTheta) ||
      !Number.isFinite(p.relIntensity) ||
      p.relIntensity <= 0
    ) {
      continue
    }
    if (p.twoTheta < twoThetaMin - window || p.twoTheta > twoThetaMax + window) {
      continue
    }
    const lo = Math.max(0, Math.floor((p.twoTheta - window - twoThetaMin) / step))
    const hi = Math.min(
      nPoints - 1,
      Math.ceil((p.twoTheta + window - twoThetaMin) / step),
    )
    const amp = p.relIntensity * scale
    for (let i = lo; i <= hi; i++) {
      y[i] += amp * pseudoVoigt(x[i], p.twoTheta, fwhmDeg, eta)
    }
  }
  return { x, y }
}
