// LocalProXrd — drop-in replacement for the XRD search / refine subset
// of `useProApi`. Self-contained Port Plan §P4-β offline-v1.
//
// Stateless: every call passes the spectrum and any detected peaks
// explicitly instead of relying on backend session state. The renderer
// keeps authoritative ownership of the pattern; the worker is just a
// computation resource.
//
// • search — bundled phase lookup via `worker/tools/xrd.py` against
//            `worker/data/xrd_references.json` (2θ-to-d conversion
//            uses the wavelength the caller selected).
// • refine — approximate isotropic whole-pattern fit. NOT full Rietveld;
//            the worker response carries `analysis_method:
//            "approximate_isotropic_fit"` so the renderer can label the
//            output honestly.

import { callWorker } from './worker-client'
import type { ProWorkbenchSpectrum } from '../types/artifact'
import type {
  ProPeak,
  XrdRefineData,
  XrdRefineRequest,
  XrdRefineResponse,
  XrdSearchRequest,
  XrdSearchResponse,
} from '../types/pro-api'

function spectrumPayload(spectrum: ProWorkbenchSpectrum) {
  return {
    x: spectrum.x,
    y: spectrum.y,
    spectrumType: spectrum.spectrumType ?? 'xrd',
  }
}

function spectrumMissing<T extends { success: false; error: string }>(): T {
  return {
    success: false,
    error: 'No spectrum loaded — open or import an XRD spectrum first.',
  } as T
}

function hasPoints(values: unknown): values is number[] {
  return (
    Array.isArray(values) &&
    values.length > 0 &&
    values.every((v) => typeof v === 'number')
  )
}

function normalizeRefineData(data: XrdRefineData): XrdRefineData {
  const fitted = data.fitted_pattern
  if (!fitted || typeof fitted !== 'object') return data

  const next: XrdRefineData = { ...data }
  let changed = false
  for (const key of ['x', 'y_obs', 'y_calc', 'y_diff'] as const) {
    const topLevel = next[key]
    const nested = fitted[key]
    if (!hasPoints(topLevel) && hasPoints(nested)) {
      next[key] = nested
      changed = true
    }
  }

  if (
    !hasPoints(next.y_diff) &&
    hasPoints(next.y_obs) &&
    hasPoints(next.y_calc) &&
    next.y_obs.length === next.y_calc.length
  ) {
    next.y_diff = next.y_obs.map((y, i) => y - next.y_calc![i])
    changed = true
  }

  return changed ? next : data
}

function normalizeRefineResponse(
  response: XrdRefineResponse,
): XrdRefineResponse {
  if (!response.success) return response
  const data = normalizeRefineData(response.data)
  return data === response.data ? response : { ...response, data }
}

export interface XrdSearchExtraRequest extends XrdSearchRequest {
  /** Explicit peaks from the workbench. Preferred over the worker's
   *  auto-detect fallback; passing an empty list still lets the worker
   *  try auto-detection from the spectrum. */
  peaks?: ProPeak[]
}

export const localProXrd = {
  /** Search the bundled reference DB. `spectrum` is used as a fallback
   *  when `peaks` is empty so the button still works with an unprocessed
   *  pattern. */
  async search(
    spectrum: ProWorkbenchSpectrum | null,
    req: XrdSearchExtraRequest,
  ): Promise<XrdSearchResponse> {
    const hasSpectrum = !!spectrum && spectrum.x.length > 0
    const hasPeaks = Array.isArray(req.peaks) && req.peaks.length > 0
    if (!hasSpectrum && !hasPeaks) return spectrumMissing()

    const result = await callWorker<XrdSearchResponse>(
      'xrd.search',
      {
        ...(hasSpectrum && spectrum
          ? { spectrum: spectrumPayload(spectrum) }
          : {}),
        peaks: req.peaks ?? [],
        elements: req.elements,
        tolerance: req.tolerance,
        top_k: req.top_k,
        wavelength: req.wavelength,
      },
      { timeoutMs: 15_000 },
    )
    if (!result.ok) return { success: false, error: result.error }
    return result.value
  },

  /** Approximate whole-pattern fit. Requires a spectrum; if no phases
   *  are selected, the worker returns a `{success:false}` payload that
   *  flows straight through to the UI toast. */
  async refine(
    spectrum: ProWorkbenchSpectrum | null,
    req: XrdRefineRequest,
  ): Promise<XrdRefineResponse> {
    if (!spectrum || spectrum.x.length === 0) return spectrumMissing()

    const result = await callWorker<XrdRefineResponse>(
      'xrd.refine',
      {
        spectrum: spectrumPayload(spectrum),
        material_ids: (req.material_ids ?? []).filter(
          (id): id is string => typeof id === 'string' && id.length > 0,
        ),
        wavelength: req.wavelength,
        two_theta_min: req.two_theta_min,
        two_theta_max: req.two_theta_max,
        max_phases: req.max_phases,
      },
      { timeoutMs: 60_000 },
    )
    if (!result.ok) return { success: false, error: result.error }
    return normalizeRefineResponse(result.value)
  },

  /** Full Rietveld fit via the external DARA/BGMN service.
   *
   *  Distinct from `refine()` in three places:
   *    1. Requires at least one CIF (as `cif_paths` or inline `cif_texts`).
   *       The worker rejects both-empty with a clear error.
   *    2. Uses a different worker handler (`xrd.refine_dara`) that writes
   *       the spectrum to a tmp `.xy` file and HTTP-POSTs to
   *       `DARA_SERVICE_URL` (defaults to localhost:8100).
   *    3. Timeout is generous (5 min) — BGMN refinements can run for
   *       minutes on complex multi-phase mixtures.
   *
   *  The renderer only calls this after the `DaraStatusBanner` has
   *  confirmed `configured: true`; a direct call with the service
   *  unreachable still degrades with a descriptive `{success:false}`
   *  error rather than hanging.
   */
  async refineDara(
    spectrum: ProWorkbenchSpectrum | null,
    req: XrdRefineRequest & {
      cif_texts?: Array<{ filename: string; content: string }>
    },
  ): Promise<XrdRefineResponse> {
    if (!spectrum || spectrum.x.length === 0) return spectrumMissing()

    const cifPaths = (req.cif_paths ?? []).filter(
      (p): p is string => typeof p === 'string' && p.length > 0,
    )
    const cifTexts = (req.cif_texts ?? []).filter(
      (c) =>
        typeof c.filename === 'string' &&
        typeof c.content === 'string' &&
        c.content.length > 0,
    )
    if (cifPaths.length === 0 && cifTexts.length === 0) {
      return {
        success: false,
        error:
          'DARA refinement needs at least one CIF. Load a CIF file before running the fit.',
      }
    }

    const result = await callWorker<XrdRefineResponse>(
      'xrd.refine_dara',
      {
        spectrum: spectrumPayload(spectrum),
        cif_paths: cifPaths.length > 0 ? cifPaths : undefined,
        cif_texts: cifTexts.length > 0 ? cifTexts : undefined,
        instrument_profile: req.instrument_profile,
        wmin: req.two_theta_min,
        wmax: req.two_theta_max,
      },
      // BGMN jobs routinely run 30–120s; allow 5 min before we give up.
      { timeoutMs: 300_000 },
    )
    if (!result.ok) return { success: false, error: result.error }
    return normalizeRefineResponse(result.value)
  },
}
