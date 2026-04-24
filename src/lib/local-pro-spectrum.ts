// LocalProSpectrum — local replacement for the subset of `useProApi`
// methods that are pure spectrum analysis: `detectPeaks` and
// `assessQuality`. Self-contained Port Plan §P4-β v0.
//
// Routes through the repo-local Python worker (see worker/tools/
// spectrum.py for the numpy/scipy implementation). Unlike the
// lattice-cli REST endpoints these methods are STATELESS — the caller
// passes the spectrum data explicitly instead of relying on a
// server-side "current spectrum" session. That keeps the worker
// process side-effect-free and makes per-call routing trivial.
//
// Other Pro methods (xrdSearch / xrdRefine / xpsFit / ramanIdentify /
// snippets / pdf scan / etc.) still flow through `useProApi` until a
// later P4 phase ports them.

import { callWorker } from './worker-client'
import type { ProWorkbenchSpectrum } from '../types/artifact'
import type {
  AssessQualityResponse,
  DetectPeaksRequest,
  DetectPeaksResponse,
  ProPeak,
} from '../types/pro-api'

interface WorkerDetectPeaksResult {
  success: true
  peaks: ProPeak[]
  total: number
  type: string
  data?: {
    spectrum_type: string
    peaks: ProPeak[]
    n_peaks: number
    algorithm?: string
    full_range?: [number, number]
    applied_range?: [number, number]
    warnings?: string[]
  }
  summary?: string
}

interface WorkerAssessQualityResult {
  success: true
  grade: 'good' | 'fair' | 'poor'
  snr: number
  n_points: number
  noise_sigma: number
  baseline: number
  issues: string[]
  recommendations: string[]
}

// ── Smooth / baseline (Phase Q · curve preprocessing) ───────────────

export interface SmoothRequest {
  method?: 'savgol' | 'moving_average' | 'gaussian' | 'none'
  window?: number
  order?: number
  sigma?: number
}

export type SmoothResponse =
  | { success: true; y: number[]; method: string }
  | { success: false; error: string }

export interface BaselineRequest {
  method?: 'none' | 'linear' | 'polynomial' | 'shirley' | 'snip'
  order?: number
  iterations?: number
}

export type BaselineResponse =
  | { success: true; y: number[]; baseline: number[]; method: string }
  | { success: false; error: string }

interface WorkerSmoothResult {
  success: true
  y: number[]
  method: string
}

interface WorkerBaselineResult {
  success: true
  y: number[]
  baseline: number[]
  method: string
}

/** Convert the spectrum's array fields into a worker-friendly payload.
 *  Coercing once here keeps the caller surface simple (just pass the
 *  artifact's spectrum object). */
function spectrumToParams(spectrum: ProWorkbenchSpectrum): Record<string, unknown> {
  return {
    x: spectrum.x,
    y: spectrum.y,
    spectrumType: spectrum.spectrumType ?? null,
  }
}

function spectrumMissing(): DetectPeaksResponse {
  return {
    success: false,
    error:
      'No spectrum loaded — open or import a spectrum before running peak detection.',
  }
}

function spectrumMissingQuality(): AssessQualityResponse {
  return {
    success: false,
    error:
      'No spectrum loaded — open or import a spectrum before assessing quality.',
  }
}

export const localProSpectrum = {
  /** Equivalent to `useProApi().detectPeaks(req)` but bound to an
   *  explicit spectrum rather than the backend's session state. */
  async detectPeaks(
    spectrum: ProWorkbenchSpectrum | null,
    req: DetectPeaksRequest = {},
  ): Promise<DetectPeaksResponse> {
    if (!spectrum || spectrum.x.length === 0) return spectrumMissing()
    const result = await callWorker<WorkerDetectPeaksResult>(
      'spectrum.detect_peaks',
      {
        ...spectrumToParams(spectrum),
        topk: req.topk,
        prominence_mult: req.prominence_mult,
        x_min: req.x_min ?? null,
        x_max: req.x_max ?? null,
      },
      { timeoutMs: 30_000 },
    )
    if (!result.ok) {
      return { success: false, error: result.error }
    }
    const value = result.value
    return {
      success: true,
      peaks: value.peaks,
      total: value.total,
      type: value.type,
      file: spectrum.sourceFile ?? undefined,
      data: value.data,
      summary: value.summary,
    }
  },

  /** Smooth a curve via SG / moving-average / Gaussian. Routes to
   *  `worker/tools/spectrum_preprocess.py:smooth`. Returns the new y
   *  vector — caller decides how to mount it back onto the spectrum. */
  async smooth(
    spectrum: ProWorkbenchSpectrum | null,
    req: SmoothRequest,
  ): Promise<SmoothResponse> {
    if (!spectrum || spectrum.x.length === 0) {
      return { success: false, error: 'No spectrum loaded — import data first.' }
    }
    const result = await callWorker<WorkerSmoothResult>(
      'spectrum.smooth',
      {
        ...spectrumToParams(spectrum),
        method: req.method ?? 'savgol',
        window: req.window ?? 11,
        order: req.order ?? 3,
        sigma: req.sigma ?? 1.5,
      },
      { timeoutMs: 15_000 },
    )
    if (!result.ok) return { success: false, error: result.error }
    return {
      success: true,
      y: result.value.y,
      method: result.value.method,
    }
  },

  /** Apply a baseline correction (linear / polynomial / Shirley / SNIP).
   *  Returns the new y vector with the baseline subtracted. */
  async baseline(
    spectrum: ProWorkbenchSpectrum | null,
    req: BaselineRequest,
  ): Promise<BaselineResponse> {
    if (!spectrum || spectrum.x.length === 0) {
      return { success: false, error: 'No spectrum loaded — import data first.' }
    }
    const result = await callWorker<WorkerBaselineResult>(
      'spectrum.baseline',
      {
        ...spectrumToParams(spectrum),
        method: req.method ?? 'polynomial',
        order: req.order ?? 3,
        iterations: req.iterations ?? 16,
      },
      { timeoutMs: 30_000 },
    )
    if (!result.ok) return { success: false, error: result.error }
    return {
      success: true,
      y: result.value.y,
      baseline: result.value.baseline,
      method: result.value.method,
    }
  },

  /** Equivalent to `useProApi().assessQuality()`. */
  async assessQuality(
    spectrum: ProWorkbenchSpectrum | null,
  ): Promise<AssessQualityResponse> {
    if (!spectrum || spectrum.x.length === 0) return spectrumMissingQuality()
    const result = await callWorker<WorkerAssessQualityResult>(
      'spectrum.assess_quality',
      spectrumToParams(spectrum),
      { timeoutMs: 15_000 },
    )
    if (!result.ok) {
      return { success: false, error: result.error }
    }
    const v = result.value
    return {
      success: true,
      grade: v.grade,
      snr: v.snr,
      n_points: v.n_points,
      issues: v.issues,
      recommendations: v.recommendations,
      noise_sigma: v.noise_sigma,
      baseline: v.baseline,
    }
  },
}
