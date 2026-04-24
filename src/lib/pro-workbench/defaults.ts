// Default payload builders for each Pro workbench artifact kind.
//
// These are pure functions — no store access, no side effects — so they can
// be used freely from components (e.g. "Reset to defaults" buttons) as well
// as from the `createProWorkbench` factory. Each builder is exported
// individually so the tree-shaking surface stays minimal.

import type {
  ComputeProPayload,
  CurveProPayload,
  CurveSubState,
  ProWorkbenchSpectrum,
  RamanProPayload,
  RamanSubState,
  SpectrumProPayload,
  SpectrumTechnique,
  XpsProPayload,
  XpsSubState,
  XrdProPayload,
  XrdSubState,
} from '../../types/artifact'

// ─── XRD ────────────────────────────────────────────────────────────

export function defaultXrdProPayload(
  spectrum: ProWorkbenchSpectrum | null = null,
): XrdProPayload {
  return {
    spectrum,
    params: {
      peakDetect: {
        engine: 'scipy',
        prominenceMult: 1.0,
        topK: 20,
        snr: 3.0,
        minSpacing: 0.2,
        background: 'snip',
        bgWindow: 60,
      },
      phaseSearch: {
        elements: '',
        tolerance: 0.3,
        topK: 20,
      },
      refinement: {
        wavelength: 'Cu',
        twoThetaMin: 10,
        twoThetaMax: 80,
        maxPhases: 3,
        useDara: true,
      },
      yScale: 'linear',
      scherrer: {
        kFactor: 0.9,
      },
    },
    peaks: [],
    uploadedCifs: [],
    candidates: [],
    refineResult: null,
    quality: null,
    status: 'idle',
    lastError: null,
  }
}

// ─── XPS ────────────────────────────────────────────────────────────

export function defaultXpsProPayload(
  spectrum: ProWorkbenchSpectrum | null = null,
): XpsProPayload {
  return {
    spectrum,
    params: {
      energyWindow: { min: null, max: null },
      yScale: 'linear',
      chargeCorrect: {
        mode: 'auto',
        referenceEV: 284.8,
        manualShift: 0,
        searchRange: [282, 290],
      },
      peakDetect: {
        prominenceMult: 1.0,
        topK: 20,
        minSpacing: 0.5,
      },
      fit: {
        background: 'shirley',
        method: 'least_squares',
        voigtEta: 0.3,
        fwhmMin: 0.3,
        fwhmMax: 4.0,
        maxIter: 5000,
      },
      quantify: {
        // `scofield` is the catalog shipped in `worker/data/` — the old
        // default (`kratos_f1s`) pointed at a table we never actually
        // wired. Existing persisted artifacts keep whatever they had and
        // can re-select from the RSF dropdown.
        rsfSet: 'scofield',
        elements: '',
      },
      lookup: {
        element: '',
        be: null,
        tolerance: 1.0,
      },
    },
    detectedPeaks: [],
    peakDefinitions: [],
    chargeCorrection: null,
    fitResult: null,
    quality: null,
    status: 'idle',
    lastError: null,
  }
}

// ─── Raman / FTIR ───────────────────────────────────────────────────

export function defaultRamanProPayload(
  spectrum: ProWorkbenchSpectrum | null = null,
  mode: 'raman' | 'ftir' = 'raman',
): RamanProPayload {
  return {
    spectrum,
    params: {
      mode,
      yScale: 'linear',
      smooth: { sgWindow: 11, sgOrder: 3 },
      baseline: { method: 'polynomial', order: 3 },
      peakDetect: {
        prominenceMult: 0.03,
        minSpacing: mode === 'ftir' ? 10 : 8,
        topK: 20,
      },
      assignment: { tolerance: 0.5 },
    },
    peaks: [],
    matches: [],
    quality: null,
    status: 'idle',
    lastError: null,
  }
}

// ─── Curve ──────────────────────────────────────────────────────────

export function defaultCurveProPayload(
  spectrum: ProWorkbenchSpectrum | null = null,
): CurveProPayload {
  return {
    spectrum,
    params: {
      yScale: 'linear',
      smooth: { method: 'savgol', window: 11, order: 3, sigma: 1.5 },
      baseline: { method: 'polynomial', order: 3, iterations: 16 },
      peakDetect: { prominenceMult: 0.05, topK: 30, minSpacing: 5 },
    },
    peaks: [],
    processedY: null,
    quality: null,
    status: 'idle',
    lastError: null,
  }
}

// ─── Sub-state slicers (for `spectrum-pro` multiplexing) ─────────────

/** Build the per-technique sub-state slices by re-using the legacy
 *  default builders and stripping the shared fields. */
function xrdSubStateFromDefault(): XrdSubState {
  const { spectrum: _s, quality: _q, status: _st, lastError: _e, ...rest } =
    defaultXrdProPayload(null)
  void _s
  void _q
  void _st
  void _e
  return rest
}
function xpsSubStateFromDefault(): XpsSubState {
  const { spectrum: _s, quality: _q, status: _st, lastError: _e, ...rest } =
    defaultXpsProPayload(null)
  void _s
  void _q
  void _st
  void _e
  return rest
}
function ramanSubStateFromDefault(
  mode: 'raman' | 'ftir' = 'raman',
): RamanSubState {
  const { spectrum: _s, quality: _q, status: _st, lastError: _e, ...rest } =
    defaultRamanProPayload(null, mode)
  void _s
  void _q
  void _st
  void _e
  return rest
}

export function curveSubStateFromDefault(): CurveSubState {
  const { spectrum: _s, quality: _q, status: _st, lastError: _e, ...rest } =
    defaultCurveProPayload(null)
  void _s
  void _q
  void _st
  void _e
  return rest
}

// ─── Spectrum (multiplexed) ─────────────────────────────────────────

export function defaultSpectrumProPayload(
  technique: SpectrumTechnique | null = null,
  spectrum: ProWorkbenchSpectrum | null = null,
): SpectrumProPayload {
  // Lazy-init every technique's sub-state so the user can switch
  // techniques without losing whatever they've tweaked elsewhere. The
  // Raman slot also covers `'ftir'` via `raman.params.mode`.
  return {
    technique,
    spectrum,
    quality: null,
    status: 'idle',
    lastError: null,
    xrd: xrdSubStateFromDefault(),
    xps: xpsSubStateFromDefault(),
    raman: ramanSubStateFromDefault(
      technique === 'ftir' ? 'ftir' : 'raman',
    ),
    curve: curveSubStateFromDefault(),
  }
}

// ─── Compute ────────────────────────────────────────────────────────

export function defaultComputeProPayload(): ComputeProPayload {
  // Empty cells — the first time the overlay opens, the Notebook renders
  // an empty-state hint and lets the user pick a cell kind from
  // "+ New cell ▾". We intentionally don't seed a cell here so the UI
  // stays free of placeholder content.
  return {
    cells: [],
    focusedCellId: null,
    timeoutS: 60,
    health: null,
    status: 'idle',
    lastError: null,
  }
}
