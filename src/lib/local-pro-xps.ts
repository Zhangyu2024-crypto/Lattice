// LocalProXps — drop-in replacement for the four XPS methods on
// `useProApi`. Self-contained Port Plan §P4-γ.
//
// Routes through the repo-local Python worker (worker/tools/xps.py).
// Stateless: each call passes the spectrum / peaks / specs explicitly
// instead of relying on the lattice-cli backend's session state.
//
// • lookup        — table-driven assignment from worker/data/xps_lines.json
// • chargeCorrect — find C 1s adventitious peak, return shift
// • quantify      — atomic % from area + RSF
// • fit           — pseudo-Voigt + Shirley/linear background via curve_fit

import { callWorker } from './worker-client'
import type { ProWorkbenchSpectrum } from '../types/artifact'
import type {
  ChargeCorrectRequest,
  ChargeCorrectResponse,
  XpsAtomicResult,
  XpsFitComponent,
  XpsFitCurves,
  XpsFitRequest,
  XpsFitResponse,
  XpsFitStatistics,
  XpsLookupAssignment,
  XpsLookupRequest,
  XpsLookupResponse,
  XpsQuantifyRequest,
  XpsQuantifyResponse,
} from '../types/pro-api'

export interface XpsValidateRequest {
  elements: string[]
  peaks: Array<{ position: number; intensity?: number; prominence?: number }>
  tolerance_eV?: number
  tolerance_eV_secondary?: number
  overlap_threshold_eV?: number
}

export interface XpsValidateDetail {
  element: string
  status: 'confirmed' | 'rejected' | 'weak_match'
  rarity?: string
  reason?: string
  matched_peaks?: Array<{
    element: string
    orbital: string
    ref_eV: number
    ref_eV_shifted: number
    obs_eV: number
    delta_eV: number
    note: string
  }>
  secondary_matches?: Array<Record<string, unknown>>
  missing_peaks?: Array<{
    element: string
    orbital: string
    expected_eV: number
    original_eV: number
    note: string
  }>
  coverage?: number
  primary_match_count?: number
  secondary_match_count?: number
  required_support?: number
  close_doublet_bonus?: boolean
  split_energy_eV?: number
  note?: string
  expected_primary_eV?: string
}

export interface XpsValidateOverlapWarning {
  peak_energy: number
  candidates: Array<{
    element: string
    orbital: string
    ref_energy: number
    shifted_energy: number
  }>
  risk_level: 'high' | 'medium'
}

export interface XpsValidateResponse {
  success: boolean
  error?: string
  data?: {
    confirmed: string[]
    rejected: string[]
    charge_shift_eV: number
    reference_used: string
    details: XpsValidateDetail[]
    overlap_warnings: XpsValidateOverlapWarning[]
  }
  summary?: string
}

interface WorkerValidateResult {
  success: true
  data: {
    confirmed: string[]
    rejected: string[]
    charge_shift_eV: number
    reference_used: string
    details: XpsValidateDetail[]
    overlap_warnings: XpsValidateOverlapWarning[]
  }
  summary: string
}

interface WorkerLookupResult {
  success: true
  data: { assignments: XpsLookupAssignment[]; matches: XpsLookupAssignment[] }
  summary: string
}

interface WorkerChargeResult {
  success: true
  shift_eV: number
  c1s_found_eV?: number
}

interface WorkerQuantResult {
  success: true
  data: {
    quantification: XpsAtomicResult[]
    atomic_percentages: XpsAtomicResult[]
  }
  summary: string
}

interface WorkerFitResult {
  success: true
  fit_statistics: XpsFitStatistics
  components: XpsFitComponent[]
  curves: XpsFitCurves
  summary: string
  warnings?: string[]
  correlation_warnings?: string[]
  data?: unknown
}

function spectrumPayload(spectrum: ProWorkbenchSpectrum) {
  return {
    x: spectrum.x,
    y: spectrum.y,
    spectrumType: spectrum.spectrumType ?? 'xps',
  }
}

function spectrumMissing<T extends { success: false; error: string }>(): T {
  return {
    success: false,
    error: 'No spectrum loaded — open or import an XPS spectrum first.',
  } as T
}

export const localProXps = {
  /** lookup is spectrum-independent — only needs the peak list. */
  async lookup(req: XpsLookupRequest): Promise<XpsLookupResponse> {
    const result = await callWorker<WorkerLookupResult>(
      'xps.lookup',
      {
        peaks: req.peaks,
        tolerance: req.tolerance,
        charge_correction: req.charge_correction,
      },
      { timeoutMs: 10_000 },
    )
    if (!result.ok) return { success: false, error: result.error }
    return {
      success: true,
      data: result.value.data,
      summary: result.value.summary,
    }
  },

  async chargeCorrect(
    spectrum: ProWorkbenchSpectrum | null,
    req: ChargeCorrectRequest,
  ): Promise<ChargeCorrectResponse> {
    if (!spectrum || spectrum.x.length === 0) return spectrumMissing()
    const result = await callWorker<WorkerChargeResult>(
      'xps.charge_correct',
      {
        ...spectrumPayload(spectrum),
        mode: req.mode,
        reference_eV: req.reference_eV,
        manual_shift: req.manual_shift,
        search_range: req.search_range,
      },
      { timeoutMs: 10_000 },
    )
    if (!result.ok) return { success: false, error: result.error }
    return {
      success: true,
      shift_eV: result.value.shift_eV,
      c1s_found_eV: result.value.c1s_found_eV,
    }
  },

  /** Quantify takes a list of identified peaks (element + area + optional
   *  RSF). The lattice-cli endpoint resolved them from session state;
   *  here the caller passes them explicitly so the worker stays stateless. */
  async quantify(
    req: XpsQuantifyRequest & {
      peaks: Array<{
        element: string
        line?: string
        area: number
        rsf?: number
      }>
    },
  ): Promise<XpsQuantifyResponse> {
    const result = await callWorker<WorkerQuantResult>(
      'xps.quantify',
      {
        peaks: req.peaks,
        elements: req.elements,
        rsf_set: req.rsf_set,
      },
      { timeoutMs: 10_000 },
    )
    if (!result.ok) return { success: false, error: result.error }
    return {
      success: true,
      data: result.value.data,
      summary: result.value.summary,
    }
  },

  async validate(req: XpsValidateRequest): Promise<XpsValidateResponse> {
    const result = await callWorker<WorkerValidateResult>(
      'xps.validate',
      {
        elements: req.elements,
        peaks: req.peaks,
        tolerance_eV: req.tolerance_eV,
        tolerance_eV_secondary: req.tolerance_eV_secondary,
        overlap_threshold_eV: req.overlap_threshold_eV,
      },
      { timeoutMs: 10_000 },
    )
    if (!result.ok) return { success: false, error: result.error }
    return {
      success: true,
      data: result.value.data,
      summary: result.value.summary,
    }
  },

  async fit(
    spectrum: ProWorkbenchSpectrum | null,
    req: XpsFitRequest,
  ): Promise<XpsFitResponse> {
    if (!spectrum || spectrum.x.length === 0) return spectrumMissing()
    const result = await callWorker<WorkerFitResult>(
      'xps.fit',
      {
        ...spectrumPayload(spectrum),
        peaks: req.peaks,
        doublets: req.doublets,
        background: req.background,
        method: req.method,
        energy_range: req.energy_range,
        tougaard_b: req.tougaard_b,
        tougaard_c: req.tougaard_c,
      },
      { timeoutMs: 60_000 },
    )
    if (!result.ok) return { success: false, error: result.error }
    return {
      success: true,
      fit_statistics: result.value.fit_statistics,
      components: result.value.components,
      curves: result.value.curves,
      summary: result.value.summary,
      warnings: result.value.warnings,
      correlation_warnings: result.value.correlation_warnings,
      data: result.value.data,
    }
  },
}
