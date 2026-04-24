// Types for /api/pro/* endpoints exposed by the lattice-cli backend
// (src/lattice_cli/web/server.py). Request/response shapes are derived
// from the actual FastAPI handler bodies at the line numbers noted on
// each block — NOT from any secondhand report.
//
// Every response is modelled as a discriminated union on `success`,
// which is the only contract the Python side consistently emits. The
// `error` field is truncated to ~500 chars server-side.

// ─── Shared primitives ─────────────────────────────────────────────

export interface ProPeak {
  position: number
  intensity: number
  fwhm?: number | null
  snr?: number | null
  index?: number
  label?: string
  // Additional fields that backend handlers sometimes attach
  [k: string]: unknown
}

export type ProError = {
  success: false
  error: string
  summary?: string
}

// ─── detect-peaks (server.py:1221) ─────────────────────────────────

export interface DetectPeaksRequest {
  topk?: number
  prominence_mult?: number
  x_min?: number | null
  x_max?: number | null
}

export type DetectPeaksResponse =
  | {
      success: true
      peaks: ProPeak[]
      total: number
      type: string
      file?: string
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
  | ProError

// ─── smooth (server.py:1241) ───────────────────────────────────────

export interface SmoothRequest {
  algorithm?: 'savitzky-golay' | 'moving-average' | string
  window_length?: number
  polyorder?: number
}

export type SmoothResponse =
  | { success: true; summary?: string; data?: unknown }
  | ProError

// ─── baseline (server.py:1261) ─────────────────────────────────────

export interface BaselineRequest {
  method?: 'snip' | 'polynomial' | 'airpls' | string
  snip_half_window?: number
}

export type BaselineResponse =
  | { success: true; summary?: string; data?: unknown }
  | ProError

// ─── undo (server.py:1279) ─────────────────────────────────────────

export type UndoResponse =
  | { success: true; summary: string }
  | { success: false; error: string }

// ─── clear-peaks (server.py:1291) ──────────────────────────────────

export type ClearPeaksResponse = { success: true } | { success: false; error: string }

// ─── xrd-search (server.py:1417) ───────────────────────────────────

export interface XrdCandidate {
  material_id?: string
  formula?: string
  space_group?: string
  name?: string
  score?: number
  weight_pct?: number
  /** Reference peak list shipped by `xrd.search` — used by the Pro
   *  workbench to overlay this candidate's theoretical peaks on the
   *  observed pattern. Optional so older backends / DARA responses
   *  without this field still hydrate cleanly. */
  ref_peaks?: Array<{ two_theta: number; rel_intensity: number }>
  // Open shape — different sources (dara / internal_db) return different fields
  [k: string]: unknown
}

export interface XrdSearchRequest {
  elements: string[] | string
  top_k?: number
  tolerance?: number
  wavelength?: string
}

export type XrdSearchResponse =
  | {
      success: true
      source: 'dara' | 'internal_db'
      fallback_reason?: string
      data: {
        candidates: XrdCandidate[]
        count: number
        wavelength?: string
      }
    }
  | ProError

// ─── upload-cif (server.py:1553) ───────────────────────────────────

export interface UploadedCif {
  id: string
  filename: string
  path: string
  size: number
  formula?: string
  formula_structural?: string
  space_group?: string
  a?: number
  b?: number
  c?: number
  alpha?: number
  beta?: number
  gamma?: number
  volume?: number
}

export type UploadCifResponse =
  | { success: true; cif: UploadedCif; total: number }
  | ProError

// ─── list-cifs (server.py:1602) ────────────────────────────────────

export interface ListCifsResponse {
  cifs: UploadedCif[]
  total: number
}

// ─── delete-cif (server.py:1608) ───────────────────────────────────

export interface DeleteCifRequest {
  id: string
}

export type DeleteCifResponse =
  | { success: true; total: number }
  | ProError

// ─── xrd-refine (server.py:1630) ───────────────────────────────────

export interface XrdRefineRequest {
  wavelength?: string
  material_ids?: string[]
  cif_paths?: string[]
  two_theta_min?: number
  two_theta_max?: number
  instrument_profile?: string
  max_phases?: number
  include_amorphous?: boolean
}

export interface XrdRefinedPhase {
  phase_name?: string
  hermann_mauguin?: string
  a?: number
  b?: number
  c?: number
  alpha?: number
  beta?: number
  gamma?: number
  weight_pct?: number
  confidence?: number
  [k: string]: unknown
}

export interface XrdRefineData {
  phases: XrdRefinedPhase[]
  rwp?: number
  rexp?: number
  gof?: number
  quality_flags?: string[]
  converged?: boolean
  x?: number[]
  y_obs?: number[]
  y_calc?: number[]
  y_diff?: number[]
  /** DARA/BGMN may nest the fitted curves here instead of lifting them to
   *  the top level. Renderer code normalises this shape so downstream
   *  charting can keep reading `x / y_obs / y_calc / y_diff`. */
  fitted_pattern?: {
    x?: number[]
    y_obs?: number[]
    y_calc?: number[]
    y_diff?: number[]
    [k: string]: unknown
  }
  [k: string]: unknown
}

export type XrdRefineResponse =
  | { success: true; data: XrdRefineData; summary?: string }
  | ProError

// ─── export-refined-cif (server.py:1661) ───────────────────────────

export interface ExportedCifFile {
  filename: string
  content: string
}

export type ExportRefinedCifResponse =
  | { success: true; files: ExportedCifFile[] }
  | ProError

// ─── xps-fit (server.py:1699) ──────────────────────────────────────
//
// Wire shapes match lattice-cli exactly. The backend converts each peak
// dict via `_dict_to_peak_spec` at tools/xps_fit_spectrum.py:58-73 —
// it reads `d["name"]` and `d["center"]` without .get(), so any drift on
// those field names immediately KeyErrors out of the handler. Do NOT
// rename these fields without also updating the Python helper.

export interface XpsPeakSpec {
  /** Peak label, e.g. "C1s_sp3". Required. */
  name: string
  /** Initial center in eV. Required. */
  center: number
  /** Initial FWHM in eV. Default 1.0. */
  fwhm?: number
  /** Initial amplitude. Default 1000. */
  amplitude?: number
  /** Lorentzian fraction 0..1 for pseudo-Voigt. Default 0.5. */
  fraction?: number
  /** Let center float during fit. Default true. */
  vary_center?: boolean
  vary_fwhm?: boolean
  vary_amplitude?: boolean
  /** Usually pinned. Default false. */
  vary_fraction?: boolean
  /** Lower / upper bounds on center (eV). */
  min_center?: number
  max_center?: number
}

/** Spin-orbit doublet with constrained split + area ratio. Matches
 *  `_dict_to_doublet_spec` at tools/xps_fit_spectrum.py:76-93. */
export interface XpsDoubletSpec {
  base_name: string
  center: number
  split: number
  area_ratio: number
  fwhm?: number
  amplitude?: number
  fraction?: number
  vary_center?: boolean
  vary_fwhm?: boolean
  vary_amplitude?: boolean
  vary_fraction?: boolean
  vary_split?: boolean
  vary_area_ratio?: boolean
  split_bounds?: [number, number]
}

export interface XpsFitRequest {
  peaks: XpsPeakSpec[]
  doublets?: XpsDoubletSpec[]
  background?: 'shirley' | 'linear' | 'tougaard' | string
  method?: 'least_squares' | 'leastsq' | 'nelder' | string
  energy_range?: [number, number]
  /** Tougaard U3 kernel parameters — K(E) = B·E / ((C−E²)² + D·E²).
   *  Omit to use the defaults B ≈ 2866 eV² / C ≈ 1643 eV² which
   *  reproduce the universal cross-section within ~20% for d-band metals.
   *  Ignored for `shirley` / `linear` backgrounds. */
  tougaard_b?: number
  tougaard_c?: number
}

/** Per-component fit result from `extract_fit_components`
 *  (xps/fine_fit.py:408). */
export interface XpsFitComponent {
  name: string
  center_eV: number
  center_err?: number
  fwhm_eV: number
  fwhm_err?: number
  fraction?: number
  area: number
  area_err?: number
}

export interface XpsFitStatistics {
  reduced_chi_squared?: number
  r_squared?: number
  n_variables?: number
  n_data_points?: number
  success: boolean
  message?: string
}

/** Pre-computed curves for charting, populated at server.py:1750-1761. */
export interface XpsFitCurves {
  x: number[]
  y_raw: number[]
  y_background: number[]
  y_envelope: number[]
  y_residual: number[]
  components: Record<string, number[]>
}

export type XpsFitResponse =
  | {
      success: true
      fit_statistics?: XpsFitStatistics
      components?: XpsFitComponent[]
      correlation_warnings?: string[]
      warnings?: string[]
      plot_path?: string | null
      summary?: string
      curves?: XpsFitCurves
      /** Legacy `data` key kept for backward compat — newer code should
       *  read the named fields above. */
      data?: unknown
    }
  | ProError

// ─── xps-quantify (server.py:1775) ─────────────────────────────────

export interface XpsQuantifyRequest {
  elements?: string[]
  /** Name of the RSF catalog to consult. Today the worker ships
   *  `"scofield"` (Scofield 1976 Al Kα cross-sections, normalised to
   *  C 1s = 1.0). Additional sets can be added by dropping JSON files
   *  under `worker/data/xps_rsf_*.json` and wiring them in the worker's
   *  `_RSF_CATALOG_PATHS`. When the name is unknown, the worker falls
   *  back to an empty lookup and flags every peak as "no RSF". */
  rsf_set?: string
}

export interface XpsAtomicResult {
  element: string
  line?: string
  atomic_percent: number
  rsf?: number
  area?: number
  [k: string]: unknown
}

export type XpsQuantifyResponse =
  | {
      success: true
      data?: {
        quantification?: XpsAtomicResult[]
        atomic_percentages?: XpsAtomicResult[]
        [k: string]: unknown
      }
      summary?: string
    }
  | ProError

// ─── raman-identify (server.py:1791) ───────────────────────────────

export interface RamanIdentifyRequest {
  peaks?: ProPeak[]
  tolerance?: number
}

export interface RamanMatch {
  name: string
  formula?: string
  score?: number
  matched_peaks?: number
  reference_peaks?: number[]
  [k: string]: unknown
}

export type RamanIdentifyResponse =
  | {
      success: true
      data?: { matches: RamanMatch[]; [k: string]: unknown }
      summary?: string
    }
  | ProError

// ─── assess-quality (server.py:1809) ───────────────────────────────

export type QualityGrade = 'good' | 'fair' | 'poor'

export type AssessQualityResponse =
  | {
      success?: true
      grade: QualityGrade
      snr?: number
      n_points?: number
      issues: string[]
      recommendations: string[]
      [k: string]: unknown
    }
  | ProError

// ─── predict-xrd (server.py:1824) ──────────────────────────────────

export interface PredictXrdRequest {
  source?: string
  wavelength?: string
  two_theta_range?: [number, number]
}

export type PredictXrdResponse =
  | {
      success: true
      data: {
        x?: number[]
        y?: number[]
        pattern?: { x: number[]; y: number[] }
        [k: string]: unknown
      }
      summary?: string
    }
  | ProError

// ─── charge-correct (server.py:1962) ───────────────────────────────

export interface ChargeCorrectRequest {
  mode?: 'auto' | 'manual'
  reference_eV?: number
  search_range?: [number, number]
  manual_shift?: number
}

export type ChargeCorrectResponse =
  | {
      success: true
      shift_eV: number
      c1s_found_eV?: number
    }
  | ProError

// ─── xps-lookup (server.py:2012) ───────────────────────────────────

export interface XpsLookupRequest {
  peaks: ProPeak[]
  tolerance?: number
  charge_correction?: number
}

export interface XpsLookupAssignment {
  element?: string
  line?: string
  binding_energy?: number
  chemical_state?: string
  reference?: string
  score?: number
  /** Bayesian-flavoured confidence in [0, 1]. Gaussian likelihood on the
   *  BE residual (σ = tolerance/3) multiplied by a frequency prior in
   *  [0.5, 1.5] drawn from the catalog entry (`entry.frequency`,
   *  defaulting to 0.5). Ranks assignments better than `score` when
   *  multiple reference states sit within tolerance — common states with
   *  tight BE match land ≥ 0.8, edge matches on obscure states < 0.5. */
  confidence?: number
  /** Modified Auger parameter α' = BE_XPS + KE_Auger (eV). Populated by
   *  the worker when the current lookup matched both a core-level and an
   *  Auger transition for this element, using Al Kα as the KE reference
   *  (see `_AL_KA_EV` in `worker/tools/xps.py`). Duplicated across all
   *  rows of the same element so any individual row can render it. */
  wagner_parameter?: number
  [k: string]: unknown
}

export type XpsLookupResponse =
  | {
      success: true
      data?: {
        assignments?: XpsLookupAssignment[]
        matches?: XpsLookupAssignment[]
        [k: string]: unknown
      }
      summary?: string
    }
  | ProError

// ─── compute/exec (server.py:2537) ─────────────────────────────────

export type ComputeLanguage = 'python' | 'lammps' | 'cp2k' | 'shell'

export interface ComputeExecRequest {
  code: string
  language?: ComputeLanguage
  timeout_s?: number
}

export interface ComputeFigurePayload {
  format: 'png' | 'svg'
  base64: string
  caption?: string
}

export interface ComputeExecResponse {
  success: boolean
  error?: string
  stdout: string
  stderr: string
  exit_code: number | null
  timed_out: boolean
  duration_ms: number
  figures: ComputeFigurePayload[]
}

// ─── compute/health (server.py:2583) ───────────────────────────────

export interface ComputeHealthResponse {
  container_up: boolean
  python_version?: string | null
  packages?: Record<string, string>
  error?: string | null
  lammps_available?: boolean
  cp2k_available?: boolean
}

// ─── compute/snippets (server.py:2590) ─────────────────────────────

export interface ComputeSnippet {
  /** Stable id; used for grouping + click keys. Optional for backward
   *  compatibility with pre-port snippet shape (defaults to `name`). */
  id?: string
  /** Pretty title shown above the snippet row. Optional — falls back to
   *  `name` when missing. */
  title?: string
  /** Group label (e.g. "Symmetry", "Structure", "Diffraction"). Optional. */
  category?: string
  name: string
  language: ComputeLanguage
  code: string
  description?: string
  [k: string]: unknown
}

export interface ComputeSnippetsResponse {
  snippets: ComputeSnippet[]
}

// ─── compute/save-script (server.py:2617) ──────────────────────────

export interface SaveScriptRequest {
  name: string
  code: string
}

export type SaveScriptResponse =
  | { success: true; name: string; path: string }
  | { success: false; error: string }

// ─── compute/scripts (server.py:2635) ──────────────────────────────

export interface SavedScriptMeta {
  name: string
  filename: string
  size: number
  modified: number
}

export interface ListScriptsResponse {
  scripts: SavedScriptMeta[]
}

// ─── compute/script/{name} (server.py:2653) ────────────────────────

export interface LoadScriptResponse {
  name: string
  filename: string
  code: string
}

// ─── export-report (server.py:1868) ────────────────────────────────

export interface ExportReportRequest {
  format?: 'markdown' | 'html' | 'pdf'
  language?: string
}

export type ExportReportResponse =
  | { success: true; data?: unknown; content?: string; summary?: string }
  | ProError
