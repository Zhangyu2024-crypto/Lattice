export type ArtifactId = string

export type ArtifactKind =
  | 'spectrum'
  | 'peak-fit'
  | 'xrd-analysis'
  | 'xps-analysis'
  | 'raman-id'
  | 'structure'
  | 'compute'
  | 'job'
  | 'research-report'
  | 'batch'
  | 'material-comparison'
  | 'paper'
  | 'similarity-matrix'
  | 'optimization'
  | 'hypothesis'
  // Interactive Pro workbenches — mirror of lattice-cli /pro modules.
  // Distinct from the read-only analysis cards above: workbenches hold
  // editable params + intermediate state and can produce analysis snapshots.
  | 'xrd-pro'
  | 'xps-pro'
  | 'raman-pro'
  | 'curve-pro'
  | 'curve-analysis'
  | 'spectrum-pro'
  | 'compute-pro'
  | 'latex-document'
  // Interactive plot on the canvas — produced by `plot_spectrum` and
  // `compare_spectra` tools. Payload carries already-loaded (and
  // downsampled) x/y series + a params block the user can tune
  // in-place via PlotArtifactCard's drawer. ECharts renders from the
  // payload so tweaks are instant (no backend round-trip).
  | 'plot'

interface ArtifactBase<K extends ArtifactKind, Payload> {
  id: ArtifactId
  kind: K
  title: string
  createdAt: number
  updatedAt: number
  sourceStepId?: string
  sourceFile?: string | null
  parents?: ArtifactId[]
  params?: Record<string, unknown>
  payload: Payload
}

export interface SpectrumPayload {
  x: number[]
  y: number[]
  xLabel: string
  yLabel: string
  spectrumType: string | null
  processingChain: string[]
}

export type SpectrumArtifact = ArtifactBase<'spectrum', SpectrumPayload>

export interface PeakFitPayload {
  spectrumId: ArtifactId | null
  algorithm: string
  peaks: Array<{
    /**
     * Stable intra-artifact id used as a mention anchor target (see
     * docs/CHAT_PANEL_REDESIGN.md §4.2). Declared optional for backward
     * compatibility with older persisted data and demo fixtures; the
     * session-store rehydrate migration backfills missing ids, and any new
     * write path (MP-2 onward) must populate this field.
     */
    id?: string
    index: number
    position: number
    intensity: number
    fwhm: number | null
    area: number | null
    snr: number | null
    label: string
  }>
  chiSquared?: number | null
  residuals?: number[] | null
}

export type PeakFitArtifact = ArtifactBase<'peak-fit', PeakFitPayload>

export interface OpaquePayload {
  summary?: string
  data?: unknown
}

// ─── XRD Analysis ──────────────────────────────────────────────
export interface XrdMatchedPeak {
  position: number
  hkl: string
  intensity_obs: number
  intensity_calc: number
}

export interface XrdPhase {
  id: string
  name: string
  formula: string
  spaceGroup: string
  cifRef: string | null
  confidence: number // 0..1
  weightFraction: number | null // 0..1, Rietveld only
  matchedPeaks: XrdMatchedPeak[]
  theoreticalPattern?: { x: number[]; y: number[] }
}

export interface XrdAnalysisPayload {
  query: {
    range: [number, number]
    // 'rietveld' is retained for backward compatibility with snapshots
    // produced against the legacy lattice-cli backend; new offline-v1
    // fits emit 'approximate-fit'.
    method: 'peak-match' | 'rietveld' | 'approximate-fit'
  }
  experimentalPattern: {
    x: number[]
    y: number[]
    xLabel: string
    yLabel: string
  }
  phases: XrdPhase[]
  rietveld: { rwp: number; gof: number; converged: boolean } | null
}

export type XrdAnalysisArtifact = ArtifactBase<'xrd-analysis', XrdAnalysisPayload>

// ─── XPS Analysis ──────────────────────────────────────────────
export interface XpsPeak {
  /** Stable intra-fit id; see {@link PeakFitPayload.peaks} for the
   *  optional-then-backfilled rationale. */
  id?: string
  label: string
  binding: number
  fwhm: number
  area: number
  assignment: string
}

export interface XpsFit {
  /** Stable intra-analysis id; see {@link PeakFitPayload.peaks} for the
   *  optional-then-backfilled rationale. */
  id?: string
  element: string
  line: string
  bindingRange: [number, number]
  experimentalPattern: { x: number[]; y: number[] }
  modelPattern: { x: number[]; y: number[] }
  residuals: number[]
  peaks: XpsPeak[]
  background: 'shirley' | 'linear' | 'tougaard'
}

export interface XpsQuantRow {
  element: string
  atomicPercent: number
  relativeSensitivity: number
}

export interface XpsChargeCorrection {
  refElement: string
  refLine: string
  refBE: number
  observedBE: number
  shift: number
}

export interface XpsValidation {
  flags: string[]
}

export interface XpsAnalysisPayload {
  fits: XpsFit[]
  quantification: XpsQuantRow[]
  chargeCorrection: XpsChargeCorrection | null
  validation?: XpsValidation
}

export type XpsAnalysisArtifact = ArtifactBase<'xps-analysis', XpsAnalysisPayload>

// ─── Raman ID ──────────────────────────────────────────────────
export interface RamanMatch {
  id: string
  mineralName: string
  formula: string
  referenceSource: string
  rruffId?: string
  cosineScore: number
  referenceSpectrum: { x: number[]; y: number[] }
  keyPeaks: number[]
}

export interface RamanIdPayload {
  experimentalSpectrum: {
    x: number[]
    y: number[]
    xLabel: string
    yLabel: string
  }
  query: { source: 'RRUFF' | 'user-db'; topN: number; hint: string | null }
  matches: RamanMatch[]
}

export type RamanIdArtifact = ArtifactBase<'raman-id', RamanIdPayload>

// ─── Job Monitor ───────────────────────────────────────────────
export type JobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export type JobBackend = 'cp2k' | 'vasp' | 'lammps' | 'ase' | 'qe' | 'abinit'

export interface JobConvergencePoint {
  iter: number
  metric: string
  value: number
}

export interface JobLogLine {
  ts: number
  level: 'info' | 'warn' | 'error' | 'debug'
  text: string
}

export interface JobMonitorPayload {
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
  resultArtifactIds: ArtifactId[]
  resources?: {
    cpuHours?: number
    memGb?: number
    nodes?: number
  }
}

export type JobArtifact = ArtifactBase<'job', JobMonitorPayload>

// ─── Batch Workflow ────────────────────────────────────────────
export type BatchFileStatus = 'pending' | 'running' | 'succeeded' | 'failed'

export interface BatchFile {
  relPath: string
  status: BatchFileStatus
  durationMs?: number
  errorMessage?: string
  artifactIds?: ArtifactId[]
}

export interface BatchSummary {
  total: number
  ok: number
  failed: number
  jsonlUrl?: string
  startedAt: number
  endedAt?: number
}

export interface BatchWorkflowPayload {
  sourceDir: string
  pattern: string
  pipeline: string[]
  concurrency: number
  status: 'idle' | 'running' | 'succeeded' | 'failed'
  files: BatchFile[]
  summary?: BatchSummary
}

export type BatchArtifact = ArtifactBase<'batch', BatchWorkflowPayload>

// ─── Structure ─────────────────────────────────────────────────────
export interface StructureLatticeParams {
  a: number
  b: number
  c: number
  alpha: number
  beta: number
  gamma: number
}

export type StructureTransformKind =
  | 'supercell'
  | 'dope'
  | 'surface'
  | 'defect'
  | 'import'

export interface StructureTransform {
  id: string
  kind: StructureTransformKind
  params: Record<string, unknown>
  appliedAt: number
  note?: string
}

export interface StructureArtifactPayload {
  cif: string
  formula: string
  spaceGroup: string
  latticeParams: StructureLatticeParams
  transforms: StructureTransform[]
  /** Parent artifact (typically a compute-pro workbench) this CIF was
   *  produced from. Renders as a "From" chip on the StructureCard with
   *  a click-to-jump affordance. */
  computedFromArtifactId?: string
  /** Specific cell inside `computedFromArtifactId` that produced the
   *  CIF. Powers the StructureCard → "Used in" back-link list and the
   *  compute-cell provenance chip's jump-to-structure target. */
  computedFromCellId?: string
}

export type StructureArtifact = ArtifactBase<'structure', StructureArtifactPayload>

export function isStructureArtifact(a: Artifact): a is StructureArtifact {
  return a.kind === 'structure'
}

// ─── Compute ──────────────────────────────────────────────────────
export interface ComputeFigure {
  format: 'png' | 'svg'
  base64: string
  caption?: string
}

export type ComputeStatus = 'idle' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/** History entry for one execution of a compute artifact. Persisted on
 *  `ComputeArtifactPayload.runs[]`; the N most recent (see
 *  COMPUTE_RUN_HISTORY_LIMIT) are kept. Corresponds 1:1 to an archived
 *  workdir under `<userData>/workspace/compute/<sid>/<aid>/run_.../`
 *  when `workdir` is set. */
export interface ComputeRunEntry {
  runId: string
  startedAt: string
  finishedAt?: string
  exitCode?: number | null
  cancelled?: boolean
  durationMs?: number
  status: ComputeStatus
  /** Absolute path to the archived workdir (script, stdout.log,
   *  stderr.log, meta.json, anything the script wrote). Undefined when
   *  archival was skipped or failed. */
  workdir?: string
}

export interface ComputeArtifactPayload {
  language: 'python' | 'lammps' | 'cp2k' | 'shell'
  code: string
  stdout: string
  stderr: string
  figures: ComputeFigure[]
  exitCode: number | null
  status: ComputeStatus
  env?: { packages: string[]; pythonVersion: string }
  durationMs?: number
  /** Set while a run is in flight so Cancel knows which IPC runId to target. */
  runId?: string | null
  image?: string
  /** Per-run archive trail. Newest first; capped to the last 20 entries
   *  UI-side. Only the most recent KEEP_RUNS_PER_ARTIFACT (3 by default)
   *  have an on-disk workdir — older entries' `workdir` may point at a
   *  pruned directory, so UI should check existence before opening. */
  runs?: ComputeRunEntry[]
}

export type ComputeArtifact = ArtifactBase<'compute', ComputeArtifactPayload>

export function isComputeArtifact(a: Artifact): a is ComputeArtifact {
  return a.kind === 'compute'
}

// ─── Pro Workbench: shared types ───────────────────────────────────

/**
 * Spectrum data a Pro workbench loads to operate on. Mirrors the shape
 * of {@link SpectrumPayload} intentionally — a workbench can accept a
 * spectrum artifact's payload directly.
 */
export interface ProWorkbenchSpectrum {
  x: number[]
  y: number[]
  xLabel: string
  yLabel: string
  spectrumType: string | null
  sourceFile?: string | null
}

export interface ProDataQuality {
  grade: 'good' | 'fair' | 'poor'
  snr?: number
  nPoints?: number
  issues: string[]
  recommendations: string[]
}

export type ProWorkbenchStatus = 'idle' | 'loading' | 'ready' | 'error'

// ─── XRD Pro Workbench ────────────────────────────────────────────

export interface XrdProParams {
  peakDetect: {
    engine: 'scipy' | 'dara'
    prominenceMult: number
    topK: number
    snr: number
    minSpacing: number
    background: 'snip' | 'polynomial' | 'none'
    bgWindow: number
  }
  phaseSearch: {
    elements: string
    tolerance: number
    topK: number
  }
  refinement: {
    wavelength: 'Cu' | 'Mo' | 'Co' | 'Fe' | 'Cr' | 'Ag'
    twoThetaMin: number
    twoThetaMax: number
    maxPhases: number
    /** Selected diffractometer preset (see `INSTRUMENT_PROFILES` in
     *  `src/lib/xrd-instruments.ts`). Forwarded to the refinement worker as
     *  `instrument_profile` so the calculated pattern uses the right
     *  broadening kernel. Empty string or undefined = auto. */
    instrumentProfile?: string
    /** When true AND the DARA service is reachable, `handleRefine` routes
     *  to `xrd.refine_dara` (real BGMN Rietveld) instead of the bundled
     *  approximate isotropic fit. Toggle is gated by the
     *  `DaraStatusBanner`'s `configured` flag so it only lights up when
     *  `DARA_SERVICE_URL` is set pre-launch. */
    useDara?: boolean
  }
  /** When true (default), overlay the fit residual Δ = y_obs − y_calc on
   *  the main chart after a refinement completes. Serious users want this
   *  visible by default; casual users sometimes find it noisy, so it's
   *  toggleable from the Whole-pattern Fit section. */
  showResiduals?: boolean
  /** Intensity-axis scale for the main XRD chart. `log` helps expose weak
   *  peaks that are visually crushed by a dominant Bragg reflection.
   *  Residual overlays are suppressed on log scale because they can go
   *  negative and a log axis cannot represent non-positive values. */
  yScale?: 'linear' | 'log'
  /** When true, the Refinement Results list shows RIR-corrected wt% next
   *  to the raw peak-scale wt%. Off by default — the raw wt% is what the
   *  worker emits; RIR correction is a post-processing lens the user
   *  explicitly opts into. Uses the table in `src/lib/xrd-rir.ts`. */
  qpaRir?: boolean
  scherrer: {
    kFactor: number
    /** Instrumental FWHM in degrees, subtracted in quadrature from the
     *  observed FWHM before Scherrer (β² = β²_obs − β²_inst). Optional
     *  so older persisted payloads hydrate without migration; the panel
     *  defaults to 0.1° when absent (typical lab diffractometer). */
    instrumentalFwhm?: number
  }
}

/**
 * A user-loaded secondary pattern displayed alongside the primary
 * spectrum. Stored as raw x/y arrays rather than references to a file
 * path so the overlay survives session restarts without a second parse;
 * the tradeoff is ~80 KB per overlay at typical XRD resolution (4K
 * points × 2 floats). Callers can cap at 5–6 overlays if size becomes a
 * concern — the module UI enforces no upper bound.
 */
export interface XrdPatternOverlay {
  id: string
  /** Display name (usually the source filename's basename). */
  name: string
  x: number[]
  y: number[]
  /** Colour token used for the overlay series (plus the chip in the
   *  overlay list). Design canon is grayscale, so the module cycles
   *  through tinted grays. */
  color: string
  visible: boolean
}

export interface XrdProCif {
  id: string
  filename: string
  /** Filesystem path on the lattice-cli backend (populated when the CIF
   *  was uploaded through `useProApi.uploadCif`). Absent for CIFs loaded
   *  directly in the renderer — those carry `content` instead. DARA
   *  refinement accepts either paths or inline content. */
  path?: string
  /** Inline CIF text loaded from a user file pick in the renderer.
   *  Populated when the workbench loads the file locally without going
   *  through the backend upload. Forwarded to the worker as `cif_texts`. */
  content?: string
  size: number
  formula?: string
  spaceGroup?: string
  a?: number
  b?: number
  c?: number
  alpha?: number
  beta?: number
  gamma?: number
  /** Whether this CIF participates in the next DARA refinement run.
   *  Defaults to `undefined` (not included); the panel's + Load CIF
   *  flow pre-selects new additions. */
  selected?: boolean
}

export interface XrdProPeak {
  position: number
  intensity: number
  fwhm?: number
  snr?: number
  label?: string
}

export interface XrdProCandidate {
  material_id?: string
  formula?: string
  space_group?: string
  name?: string
  score?: number
  selected?: boolean
  /** Reference peak list (2θ positions + relative intensities normalised
   *  to the strongest peak = 1.0). Hydrated from the search response so
   *  the workbench can overlay theoretical peaks on the observed pattern
   *  without a round-trip. Stripped from persisted snapshots — re-search
   *  rehydrates. */
  refPeaks?: Array<{ twoTheta: number; relIntensity: number }>
  /** Per-candidate toggle for the theoretical-peak overlay. Default false
   *  so the chart stays clean until the user asks for a comparison. */
  showOverlay?: boolean
  /** Per-candidate toggle for the *synthesized continuous pattern* overlay
   *  — pseudo-Voigt broadening of the same `refPeaks`, rendered as a
   *  continuous curve. Complementary to `showOverlay` (ticks vs profile).
   *  Both can be on at once. */
  showSimulate?: boolean
}

export interface XrdProRefineResult {
  phases: Array<{
    phase_name?: string
    formula?: string
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
  }>
  rwp?: number
  rexp?: number
  gof?: number
  converged?: boolean
  quality_flags?: string[]
  x?: number[]
  y_obs?: number[]
  y_calc?: number[]
  y_diff?: number[]
}

/**
 * A single recorded run on a Pro workbench (refine, fit, identify,
 * detect-peaks, …). Stored optionally per-technique so Restore can reflect
 * the last run's params back into the inspector. See src/lib/pro-run-history.ts
 * for capping and sanitisation rules.
 */
export interface ProRunRecord {
  id: string
  /** Free-form command identifier; conventionally `<tech>.<verb>`. */
  command: string
  createdAt: number
  /** One-line humane description of the inputs ("2θ 10–80°, 3 phases"). */
  paramsSummary: string
  /** One-line humane description of the output ("Rwp 18.2%", "4 peaks"). */
  resultSummary: string
  /** Full params snapshot for Restore. Opaque to the rail; module's
   *  `restoreParams` hook knows how to unpack it. */
  paramsSnapshot: unknown
  /** Milliseconds. Optional — not every action is timed. */
  durationMs?: number
  /** Trailing flag when the action failed; Restore still works, the UX just
   *  dims the row. */
  failed?: boolean
}

/**
 * LLM adjudication layer on top of the peak-match retrieval. Ported from
 * lattice-cli/workflow/xrd-phase-id-standalone — the retriever returns
 * top-K candidates, then an LLM picks the subset that actually explains
 * the experimental pattern, with a free-form reasoning string.
 *
 * Absent means the workbench has candidates from peak-match alone but no
 * LLM verdict yet (cold panel, or LLM call disabled / errored).
 */
export interface XrdProIdentification {
  /** Materials IDs the LLM concluded are present in the sample. A subset
   *  of `candidates[].material_id`. Empty when the model declined to
   *  commit. */
  predictedPhases: string[]
  /** Model's own confidence 0..1. Not calibrated — treat as a hint. */
  confidence: number
  /** One-paragraph natural-language justification, for the Inspector. */
  reasoning: string
  /** Provider/model label as resolved at call time ("Anthropic / Sonnet
   *  4.5"). Persisted so stale runs are obvious when the user changes
   *  their agent model later. */
  model: string
  /** Timestamp of the identification run. */
  createdAt: number
  /** The element set the retriever was seeded with — kept next to the
   *  verdict so a user glancing at an old identification knows what the
   *  query actually constrained to. */
  elements: string[]
}

export interface XrdProPayload {
  spectrum: ProWorkbenchSpectrum | null
  params: XrdProParams
  peaks: XrdProPeak[]
  uploadedCifs: XrdProCif[]
  candidates: XrdProCandidate[]
  /** LLM's verdict on top of `candidates`. Written by both the agent
   *  tool `xrd_search_phases` and the UI's "Search Phase DB" button; see
   *  src/lib/xrd-phase-identification.ts for the pipeline. */
  identification?: XrdProIdentification | null
  refineResult: XrdProRefineResult | null
  /** Secondary patterns loaded alongside the primary spectrum — enables
   *  in-situ / operando / variable-temperature comparison without
   *  multiplying artifacts. Optional so older persisted payloads hydrate
   *  without migration; coalesce to `[]` on read. */
  patternOverlays?: XrdPatternOverlay[]
  quality: ProDataQuality | null
  status: ProWorkbenchStatus
  lastError?: string | null
  /** Run log for the Pro Workbench history rail (optional; earlier persisted
   *  sessions lack it and coalesce to `[]` on read). */
  runHistory?: ProRunRecord[]
}

export type XrdProArtifact = ArtifactBase<'xrd-pro', XrdProPayload>

// ─── XPS Pro Workbench ────────────────────────────────────────────

export interface XpsProParams {
  energyWindow: {
    min: number | null
    max: number | null
  }
  /** Main-chart intensity axis mode. `log` is useful when a dominant line
   *  visually crushes weak shoulders / satellite peaks. */
  yScale?: 'linear' | 'log'
  chargeCorrect: {
    mode: 'auto' | 'manual'
    referenceEV: number
    manualShift: number
    searchRange: [number, number]
  }
  peakDetect: {
    prominenceMult: number
    topK: number
    minSpacing: number
  }
  fit: {
    background: 'shirley' | 'linear' | 'tougaard'
    method: 'least_squares' | 'leastsq' | 'nelder'
    voigtEta: number
    fwhmMin: number
    fwhmMax: number
    maxIter: number
  }
  quantify: {
    rsfSet: string
    elements: string
  }
  lookup: {
    element: string
    be: number | null
    tolerance: number
  }
}

export interface XpsProPeakDef {
  id: string
  label: string
  type: 'single' | 'doublet'
  position: number
  intensity: number
  fwhm: number
  fixedPosition?: boolean
  fixedFwhm?: boolean
  split?: number
  branchingRatio?: number
  /** Pseudo-Voigt Gaussian/Lorentzian mixing fraction for this peak alone,
   *  overriding `params.fit.voigtEta`. 0 = pure Gaussian, 1 = pure Lorentzian.
   *  Absent means "use the workbench default". Surface vs bulk chemistry or
   *  metallic vs oxide components often want different line shapes within
   *  the same spectrum, so η is per-peak at the model level. */
  voigtEta?: number
  /** For doublets only: lock the spin-orbit split (2p3/2 ↔ 2p1/2, etc.) to
   *  its quantum-mechanical constant instead of letting the fitter drift
   *  it. Default true — the worker's legacy behaviour. Set false to let
   *  split float within ±20% of the seed (or the explicit `split_bounds`
   *  on the wire). */
  fixedSplit?: boolean
  /** For doublets only: lock the area branching ratio (e.g. 2:1 for 2p,
   *  0.67 for 4f) to its QM-derived constant. Default true. Set false
   *  to let ratio float within (0.01, 10). */
  fixedBranching?: boolean
}

export interface XpsProFitResult {
  curves?: {
    x: number[]
    y_raw: number[]
    y_background: number[]
    y_envelope: number[]
    y_residual: number[]
    components: Record<string, number[]>
  }
  data?: unknown
  appliedShiftEV?: number
  /** Fit diagnostics the worker already emits (xps.py `fit_statistics`).
   *  Previously dropped on the floor; professional users need these to
   *  defend a fit. */
  fitStatistics?: {
    reducedChiSquared?: number
    rSquared?: number
    nVariables?: number
    nDataPoints?: number
    success?: boolean
    message?: string
  }
  /** Soft warnings from the worker (non-fatal: bounds hit, low Npts, etc.). */
  warnings?: string[]
  /** High-correlation parameter warnings (two vars track each other —
   *  usually a sign the model is over-parameterised). */
  correlationWarnings?: string[]
  /** Per-component fit output: center/FWHM/area + their errors.
   *  `components` in the worker response is already keyed by name; this is
   *  a flattened list for rendering in tables. */
  componentAreas?: Array<{
    name: string
    centerEV?: number
    centerErr?: number
    fwhmEV?: number
    fwhmErr?: number
    area: number
    areaErr?: number
  }>
  quantification?: Array<{
    element: string
    line?: string
    atomic_percent: number
    area?: number
  }>
  lookupAssignments?: Array<{
    element?: string
    line?: string
    binding_energy?: number
    chemical_state?: string
    score?: number
    /** Bayesian-flavoured confidence in [0, 1]. Separate from `score`
     *  (which is a pure geometric distance measure) — this combines the
     *  BE Gaussian likelihood with an optional frequency prior, so common
     *  states rank above obscure ones at equal delta. See the UI row
     *  rendering for the colour-coded badge (≥0.8 green, ≥0.5 amber,
     *  else red). */
    confidence?: number
    /** Modified Auger parameter α' (eV). Populated by the worker when
     *  the element had both XPS and Auger hits in the lookup. */
    wagner_parameter?: number
  }>
}

/**
 * A user-loaded secondary XPS pattern displayed alongside the primary
 * spectrum. Mirrors {@link XrdPatternOverlay} — raw x/y arrays so the
 * overlay survives session restarts without a second parse. Useful for
 * depth-profile / angle-resolved / before-after series where a researcher
 * wants to eyeball chemical-state shifts across conditions without
 * spawning multiple workbenches.
 */
export interface XpsPatternOverlay {
  id: string
  /** Display name (usually the source filename's basename). */
  name: string
  x: number[]
  y: number[]
  /** Colour token used for the overlay series (plus the chip in the
   *  overlay list). Design canon is grayscale, so the module cycles
   *  through tinted grays. */
  color: string
  visible: boolean
}

export interface XpsValidationResult {
  confirmed: string[]
  rejected: string[]
  chargeShiftEV: number
  details: Array<{
    element: string
    status: 'confirmed' | 'rejected' | 'weak_match'
    rarity?: string
    reason?: string
    matched_peaks?: Array<{
      element: string
      orbital: string
      ref_eV: number
      obs_eV: number
      delta_eV: number
      note: string
    }>
    missing_peaks?: Array<{
      element: string
      orbital: string
      expected_eV: number
      note: string
    }>
    coverage?: number
    close_doublet_bonus?: boolean
    split_energy_eV?: number
  }>
  overlapWarnings: Array<{
    peak_energy: number
    candidates: Array<{ element: string; orbital: string; shifted_energy: number }>
    risk_level: 'high' | 'medium'
  }>
  createdAt: number
}

export interface XpsProPayload {
  spectrum: ProWorkbenchSpectrum | null
  params: XpsProParams
  detectedPeaks: XrdProPeak[] // reused (position / intensity / fwhm)
  peakDefinitions: XpsProPeakDef[]
  chargeCorrection: { shiftEV: number; c1sFoundEV?: number } | null
  fitResult: XpsProFitResult | null
  /** Element validation result from `xps_validate_elements`. Stored
   *  separately from `fitResult` since validation runs pre-fit (on
   *  detected peaks, not fitted components). */
  validationResult?: XpsValidationResult | null
  /** Secondary patterns loaded alongside the primary spectrum — enables
   *  depth-profile / angle-resolved / before-after comparison without
   *  multiplying artifacts. Optional so older persisted payloads hydrate
   *  without migration; coalesce to `[]` on read. */
  patternOverlays?: XpsPatternOverlay[]
  quality: ProDataQuality | null
  status: ProWorkbenchStatus
  lastError?: string | null
  runHistory?: ProRunRecord[]
}

export type XpsProArtifact = ArtifactBase<'xps-pro', XpsProPayload>

// ─── Raman (and FTIR) Pro Workbench ───────────────────────────────

export interface RamanProParams {
  mode: 'raman' | 'ftir'
  /** Main-chart intensity axis mode. `log` helps surface weak Raman lines
   *  next to a dominant band. */
  yScale?: 'linear' | 'log'
  smooth: {
    sgWindow: number
    sgOrder: number
  }
  baseline: {
    method: 'polynomial' | 'snip'
    order: number
  }
  peakDetect: {
    prominenceMult: number
    minSpacing: number
    topK: number
  }
  assignment: {
    tolerance: number
  }
}

export interface RamanProMatch {
  name: string
  formula?: string
  score?: number
  matchedPeaks?: number
  referencePeaks?: number[]
}

export interface RamanProPayload {
  spectrum: ProWorkbenchSpectrum | null
  params: RamanProParams
  peaks: XrdProPeak[]
  matches: RamanProMatch[]
  quality: ProDataQuality | null
  status: ProWorkbenchStatus
  lastError?: string | null
  runHistory?: ProRunRecord[]
}

export type RamanProArtifact = ArtifactBase<'raman-pro', RamanProPayload>

// ─── Unified Spectrum Pro Workbench ──────────────────────────────
//
// `spectrum-pro` is the Pro v2 entry point (v3 of the analysis
// artifact): one workbench kind whose UI reshapes per-technique so a
// single loaded spectrum can be inspected from XRD, XPS, or Raman/FTIR
// angles without spawning three sibling artifacts. The legacy kinds
// (`xrd-pro`, `xps-pro`, `raman-pro`) remain callable — existing
// sessions rehydrate through their respective workbench components for
// backward compat — but the launcher and docs now prefer
// `spectrum-pro`.

/** Which technique lens is currently driving the inspector / commands. */
// ─── Curve Pro Workbench ──────────────────────────────────────────
//
// Generic X-Y curve handler — mirrors lattice-cli's `curve` spectrum
// type (`_TYPE_MAP` / `_ALLOWED_TYPES = {xrd, raman, xps, curve}`).
// Used for any analytical trace that isn't one of the three named
// spectroscopies: cyclic voltammetry, kinetic decays, UV-Vis, etc.

export type CurveSmoothMethod = 'savgol' | 'moving_average' | 'gaussian' | 'none'
export type CurveBaselineMethod =
  | 'none'
  | 'linear'
  | 'polynomial'
  | 'shirley'
  | 'snip'

export interface CurveProParams {
  /** Main-chart Y-axis mode. `log` is only applied when all plotted values
   *  are strictly positive; otherwise the chart falls back to linear. */
  yScale?: 'linear' | 'log'
  smooth: {
    method: CurveSmoothMethod
    window: number
    order: number
    sigma: number
  }
  baseline: {
    method: CurveBaselineMethod
    order: number
    iterations: number
  }
  peakDetect: {
    prominenceMult: number
    topK: number
    minSpacing: number
  }
}

export interface CurveFeature {
  position: number
  intensity: number
  fwhm?: number
  prominence?: number
  label?: string
}

export interface CurveProPayload {
  spectrum: ProWorkbenchSpectrum | null
  params: CurveProParams
  /** Detected features (peaks / inflection points / steps). */
  peaks: CurveFeature[]
  /** Optional preprocessed Y vector, populated after smooth/baseline runs. */
  processedY: number[] | null
  quality: ProDataQuality | null
  status: ProWorkbenchStatus
  lastError?: string | null
  runHistory?: ProRunRecord[]
}

export type CurveProArtifact = ArtifactBase<'curve-pro', CurveProPayload>

export interface CurveAnalysisPayload {
  experimentalCurve: {
    x: number[]
    y: number[]
    xLabel?: string
    yLabel?: string
  }
  features: CurveFeature[]
  notes?: string
}

export type CurveAnalysisArtifact = ArtifactBase<
  'curve-analysis',
  CurveAnalysisPayload
>

// ─── Spectrum technique enum ──────────────────────────────────────

export type SpectrumTechnique = 'xrd' | 'xps' | 'raman' | 'ftir' | 'curve'

/**
 * Per-technique sub-state. We strip the fields that are shared at the
 * unified payload's top level (spectrum, quality, status, lastError) so
 * switching techniques never duplicates or loses those. Everything
 * else — params, peaks, candidates, fit results — is technique-local
 * and persisted so users can toggle between lenses non-destructively.
 */
export type XrdSubState = Omit<
  XrdProPayload,
  'spectrum' | 'quality' | 'status' | 'lastError'
>
export type XpsSubState = Omit<
  XpsProPayload,
  'spectrum' | 'quality' | 'status' | 'lastError'
>
export type RamanSubState = Omit<
  RamanProPayload,
  'spectrum' | 'quality' | 'status' | 'lastError'
>
export type CurveSubState = Omit<
  CurveProPayload,
  'spectrum' | 'quality' | 'status' | 'lastError'
>

export interface SpectrumProPayload {
  /** `null` = user hasn't picked a technique yet — the workbench shows an
   *  in-canvas picker instead of auto-promoting to a legacy artifact. */
  technique: SpectrumTechnique | null
  /** Source spectrum shared across every technique view. */
  spectrum: ProWorkbenchSpectrum | null
  quality: ProDataQuality | null
  status: ProWorkbenchStatus
  lastError?: string | null
  xrd: XrdSubState
  xps: XpsSubState
  /** Covers both `raman` and `ftir` techniques via `raman.params.mode`. */
  raman: RamanSubState
  /** Generic X-Y curve handling — voltammetry, kinetics, UV-Vis, anything
   *  not covered by the three named spectroscopies. Optional so older
   *  persisted payloads (pre-curve) hydrate without migration; readers
   *  coalesce with `?? defaultCurveSubState`. */
  curve?: CurveSubState
}

export type SpectrumProArtifact = ArtifactBase<
  'spectrum-pro',
  SpectrumProPayload
>

// ─── Compute Pro Workbench ────────────────────────────────────────

/** Legacy script-only language tag for backend execution. Structure cells
 *  are no longer represented here — they live as their own cell kinds. */
export type ComputeProLanguage = 'python' | 'lammps' | 'cp2k' | 'shell'

/** Cell kind = the narrow union of "what the cell produces / how it runs".
 *  `python / lammps / cp2k` execute code in the container; `structure-ai`
 *  is a natural-language prompt that the LLM proxy turns into CIF;
 *  `structure-code` is pymatgen / ASE Python that prints CIF to stdout. */
export type ComputeCellKind =
  | 'python'
  | 'lammps'
  | 'cp2k'
  | 'structure-ai'
  | 'structure-code'
  | 'markdown'
  | 'shell'

export interface ComputeProRun {
  id: string
  /** Stamped at dispatch time. For `structure-code` cells we still tag the
   *  run with the *cell* kind (not 'python') so the UI can switch on
   *  `run.cellKind` without re-looking up the parent cell. */
  cellKind: ComputeCellKind
  startedAt: number
  endedAt: number | null
  exitCode: number | null
  durationMs?: number
  timedOut: boolean
  stdout: string
  stderr: string
  figures: ComputeFigure[]
  error?: string
  /** For `structure-ai` runs: the Python code the LLM generated before
   *  it was executed in the container. Rendered as a collapsible block
   *  in the cell output so the user can inspect / copy / iterate on
   *  the model's reasoning without a second LLM roundtrip. Absent on
   *  other cell kinds — they store their user-authored code as
   *  `cell.code` directly. */
  generatedCode?: string
}

export interface ComputeProHealth {
  containerUp: boolean
  pythonVersion?: string | null
  lammpsAvailable?: boolean
  cp2kAvailable?: boolean
  packages?: Record<string, string>
  error?: string | null
  checkedAt: number
}

/** Where a cell's structure / output came from. Populated automatically by
 *  the runner on a successful build (Structure-AI / Structure-Code) or by
 *  the Tweak button when it spawns a child cell. Drives the provenance chip
 *  in the cell header and the "← from" jump affordance. */
export interface ComputeCellProvenance {
  /** Another cell in the same Compute workbench this cell was derived from
   *  (e.g. Tweak → Supercell, or an @-mention reference). */
  parentCellId?: string
  /** A session-level `StructureArtifact` the cell was loaded from. */
  parentStructureId?: string
  /** For Structure-AI cells: the first ~80 chars of the prompt. */
  prompt?: string
  /** Free-form operation label — 'code' | 'tweak:supercell' |
   *  'tweak:dope' | 'tweak:surface' | 'import' | 'simulate:md-ase' | … */
  operation?: string
  /** Set by "Save structure" once a structure-* cell's CIF has been
   *  promoted to a top-level `structure` artifact. Lets the cell UI
   *  flip its CTA to "Open saved" (idempotent — no duplicate artifact). */
  savedStructureId?: string
}

/** Persistent cell within a compute-pro workbench. Each cell owns its own
 *  code + last run; re-running updates `lastRun` in place. Duplicate cells
 *  to compare two versions of an output. */
/** User-overridden heights for the three internal panes of a cell.
 *  Absent fields fall back to the CSS defaults (editor 180 / viewer
 *  360 / console 360). Persisted on the cell so drag-to-resize survives
 *  session reloads. */
export interface ComputeCellPaneHeights {
  /** CodeMirror editor (for python / lammps / cp2k / structure-code). */
  editor?: number
  /** 3D StructureViewer inside structure-* cells' output. */
  viewer?: number
  /** stdout / stderr / CIF source <pre> max-height. */
  console?: number
}

export interface ComputeCell {
  id: string
  kind: ComputeCellKind
  /** Optional user-chosen title; when absent the UI shows "Cell #n" or a
   *  fallback derived from the first line of `code`. */
  title?: string
  /** Drag-to-resize overrides for the cell's internal panes. */
  paneHeights?: ComputeCellPaneHeights
  /** For script kinds this is source code; for `structure-ai` it is the
   *  natural-language prompt the user wrote; for `markdown` it is the
   *  raw markdown source. */
  code: string
  lastRun: ComputeProRun | null
  /** Optional — set by the runner / Tweak button, inspected by the UI. */
  provenance?: ComputeCellProvenance
  /** Monotonically incremented on every successful run (Jupyter-style
   *  `In [N]`). Lets the UI show run ordering + staleness. Undefined /
   *  0 means "never run since creation". */
  executionCount?: number
  /** Per-cell collapse flags. When true the corresponding pane is
   *  hidden behind its chevron; omitting or false = visible. */
  collapsedInput?: boolean
  collapsedOutput?: boolean
  createdAt: number
  updatedAt: number
}

export interface ComputeProPayload {
  cells: ComputeCell[]
  /** Which cell the user most recently interacted with. Drives Cmd+K
   *  context targeting and the keyboard-focus-restore on reopen. Null
   *  when the stream is empty. */
  focusedCellId: string | null
  timeoutS: number
  health: ComputeProHealth | null
  status: ProWorkbenchStatus
  lastError?: string | null
  /**
   * Absolute directory the Compute overlay's Assets rail points at.
   * **Independent** of the global workspace root (workspace-store) so
   * changing it here doesn't reroute the main Explorer. Read-only
   * listing via the `compute:list-dir-at` IPC; no write access from
   * the rail. Null until the user clicks "Pick folder".
   */
  computeWorkspacePath?: string | null
}

export type ComputeProArtifact = ArtifactBase<'compute-pro', ComputeProPayload>

/**
 * @deprecated Retained only for older persisted payloads to deserialize
 * without throwing during migrate. New cells do not emit this shape.
 */
export interface ComputeChatTurn {
  id: string
  role: 'user' | 'assistant'
  text: string
  createdAt: number
  language?: ComputeProLanguage
  appliedRunId?: string
  error?: boolean
  pending?: boolean
}

export function isXrdProArtifact(a: Artifact): a is XrdProArtifact {
  return a.kind === 'xrd-pro'
}
export function isXpsProArtifact(a: Artifact): a is XpsProArtifact {
  return a.kind === 'xps-pro'
}
export function isRamanProArtifact(a: Artifact): a is RamanProArtifact {
  return a.kind === 'raman-pro'
}
export function isComputeProArtifact(a: Artifact): a is ComputeProArtifact {
  return a.kind === 'compute-pro'
}
export function isSpectrumProArtifact(a: Artifact): a is SpectrumProArtifact {
  return a.kind === 'spectrum-pro'
}
export function isCurveProArtifact(a: Artifact): a is CurveProArtifact {
  return a.kind === 'curve-pro'
}
export function isCurveAnalysisArtifact(a: Artifact): a is CurveAnalysisArtifact {
  return a.kind === 'curve-analysis'
}

// ─── LaTeX writing module (see src/types/latex.ts for the payload) ──
import type { LatexDocumentPayload } from './latex'
export type LatexDocumentArtifact = ArtifactBase<'latex-document', LatexDocumentPayload>
export function isLatexDocumentArtifact(a: Artifact): a is LatexDocumentArtifact {
  return a.kind === 'latex-document'
}

// ─── Still opaque (payload details live in each card's local types) ──
export type ResearchReportArtifact = ArtifactBase<'research-report', OpaquePayload>
export type MaterialComparisonArtifact = ArtifactBase<'material-comparison', OpaquePayload>
export type PaperArtifact = ArtifactBase<'paper', OpaquePayload>
export type SimilarityMatrixArtifact = ArtifactBase<'similarity-matrix', OpaquePayload>
export type OptimizationArtifact = ArtifactBase<'optimization', OpaquePayload>

// ─── Hypothesis payload (shared by card, demo, agent tools) ─────────
//
// Promoted from OpaquePayload so agent tools and the HypothesisArtifactCard
// share a single source of truth. All new fields are optional to stay
// backward-compatible with existing persisted payloads and demo data.

export type HypothesisStatus = 'open' | 'supported' | 'refuted' | 'inconclusive'
export type EvidenceStrength = 'strong' | 'moderate' | 'weak'

export interface HypEvidence {
  id: string
  /** Linked artifact id (XRD analysis, paper, etc.). */
  artifactId?: string
  /** How the evidence was discovered. */
  sourceType?: 'artifact' | 'paper' | 'rag' | 'web' | 'manual'
  note: string
  strength: EvidenceStrength
  direction: 'supports' | 'refutes'
  createdAt: number
}

export interface Hypothesis {
  id: string
  statement: string
  status: HypothesisStatus
  confidence: number
  createdAt: number
  updatedAt: number
  evidence: HypEvidence[]
  nextTests: string[]
  tags: string[]
  /** Incremented each time new evidence is appended by gather_evidence. */
  evidenceVersion?: number
  /** Whether the status was set by the auto-evaluate tool or by the user. */
  statusSource?: 'auto' | 'manual'
  /** Evidence version at the time of last evaluation. */
  lastEvaluatedVersion?: number
}

export interface HypothesisPayload {
  topic: string
  hypotheses: Hypothesis[]
  /** Summary produced by the hypothesis_evaluate tool. */
  evaluationSummary?: string | null
  /** Timestamp of the last automated evaluation. */
  lastEvaluatedAt?: number | null
}

export type HypothesisArtifact = ArtifactBase<'hypothesis', HypothesisPayload>

// ─── Plot artifact ─────────────────────────────────────────────────────
//
// Produced by `plot_spectrum` and `compare_spectra`. The payload stores
// ALREADY-LOADED (and downsampled to keep persist size sane) x/y arrays
// so the card can re-render instantly when the user tunes `params` —
// no backend round-trip, no file re-read. PNG export still goes through
// `src/lib/spectrum-plot.ts`'s off-screen renderer when the user clicks
// Export PNG.

/** How series relate on the chart. Mirrors `compare_spectra`'s `mode`
 *  parameter; `single` is what `plot_spectrum` produces. */
export type PlotMode =
  | 'single'
  | 'overlay'
  | 'offset'
  | 'stacked'
  | 'difference'

export interface PlotSeries {
  id: string
  x: number[]
  y: number[]
  label: string
  color?: string
  dashed?: boolean
  /** Point count before downsample; absent means the series is already
   *  full-resolution. Surfaced as a chip so experts know the preview is
   *  a cheap summary and the Export PNG uses the same (downsampled)
   *  data — re-running the tool with fresh args replays from source. */
  downsampledFrom?: number
}

export interface PlotPeak {
  x: number
  label?: string
  intensity?: number
}

export interface PlotReference {
  x: number[]
  y: number[]
  label: string
  color?: string
  dashed?: boolean
}

export interface PlotParams {
  title?: string
  xLabel?: string
  yLabel?: string
  logY: boolean
  showLegend: boolean
  grid: boolean
  journalStyle: 'default' | 'minimal' | 'acs' | 'rsc' | 'nature'
  /** PNG export dimensions. The on-screen chart fills its container;
   *  these are only passed through to `renderSpectrum` at export time. */
  width: number
  height: number
  /** For `offset` mode — fraction of per-series amplitude applied as the
   *  vertical step between curves. Defaults to 0.2. Ignored in other
   *  modes. */
  offsetFraction?: number
}

export interface PlotPayload {
  mode: PlotMode
  series: PlotSeries[]
  peaks: PlotPeak[]
  references: PlotReference[]
  params: PlotParams
  /** Audit-only: the source relPaths the tool loaded from. Rendered as
   *  a subtle chip in the header so the user can trace a plot back to
   *  its inputs. NOT consulted on re-render. */
  sourceRelPaths: string[]
}

export type PlotArtifact = ArtifactBase<'plot', PlotPayload>

export type Artifact =
  | SpectrumArtifact
  | PeakFitArtifact
  | XrdAnalysisArtifact
  | XpsAnalysisArtifact
  | RamanIdArtifact
  | StructureArtifact
  | ComputeArtifact
  | JobArtifact
  | ResearchReportArtifact
  | BatchArtifact
  | MaterialComparisonArtifact
  | PaperArtifact
  | SimilarityMatrixArtifact
  | OptimizationArtifact
  | HypothesisArtifact
  | XrdProArtifact
  | XpsProArtifact
  | RamanProArtifact
  | CurveProArtifact
  | CurveAnalysisArtifact
  | SpectrumProArtifact
  | ComputeProArtifact
  | LatexDocumentArtifact
  | PlotArtifact

export function isPlotArtifact(a: Artifact): a is PlotArtifact {
  return a.kind === 'plot'
}

export function isSpectrumArtifact(a: Artifact): a is SpectrumArtifact {
  return a.kind === 'spectrum'
}

export function isPeakFitArtifact(a: Artifact): a is PeakFitArtifact {
  return a.kind === 'peak-fit'
}

export function isXrdAnalysisArtifact(a: Artifact): a is XrdAnalysisArtifact {
  return a.kind === 'xrd-analysis'
}

export function isXpsAnalysisArtifact(a: Artifact): a is XpsAnalysisArtifact {
  return a.kind === 'xps-analysis'
}

export function isRamanIdArtifact(a: Artifact): a is RamanIdArtifact {
  return a.kind === 'raman-id'
}

export function isJobArtifact(a: Artifact): a is JobArtifact {
  return a.kind === 'job'
}
