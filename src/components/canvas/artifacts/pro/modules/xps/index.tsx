// XPS technique module — the XpsProWorkbench feature surface decomposed
// into the `TechniqueModule` interface. All handlers funnel through
// `ModuleCtx.patchShared` / `patchSubState`, so the module is
// payload-shape-agnostic. The legacy `XpsProWorkbench` shim projects the
// top-level `XpsProPayload` into a `SpectrumProPayload`-shaped view; the
// unified workbench rides on `payload.xps.*` directly.
//
// The render-only pieces (main chart, quantification tab, vars schema,
// footer, commands, helpers) live in `./parts/*` — keeping this file
// focused on the action hook and the module wiring.

import { useCallback, useState, type ReactNode } from 'react'
import type {
  ProDataQuality,
  XpsPatternOverlay,
  XpsProFitResult,
  XpsProPayload,
  XpsProPeakDef,
  XpsSubState,
  XrdProPeak,
} from '@/types/artifact'
import type {
  AssessQualityResponse,
  ChargeCorrectResponse,
  DetectPeaksResponse,
  XpsFitResponse,
  XpsLookupResponse,
  XpsQuantifyResponse,
} from '@/types/pro-api'
import { localProSpectrum } from '@/lib/local-pro-spectrum'
import { localProXps } from '@/lib/local-pro-xps'
import {
  canParseLocally,
  needsBinaryRead,
  OVERLAY_MAX_BYTES,
  parseSpectrumText,
} from '@/lib/parsers/parse-spectrum-file'
import { buildXpsSpecs } from '@/lib/xps-peak-spec-build'
import { toast } from '@/stores/toast-store'
import { defaultXpsProPayload } from '@/lib/pro-workbench'
import { GRAYSCALE_OVERLAY_COLORS } from '@/lib/chart-colors'
import XpsParameterPanel from '@/components/canvas/artifacts/XpsProWorkbench.panel'
import { useChartExporter } from '@/hooks/useChartExporter'
import { useFocusedPeak } from '@/hooks/useFocusedPeak'
import { appendRunRecord } from '@/lib/pro-run-history'
import ProPeakTable, {
  type PeakColumnDef,
} from '@/components/canvas/artifacts/pro/primitives/ProPeakTable'
import ProVarsTab from '@/components/canvas/artifacts/pro/primitives/ProVarsTab'
import { S } from '@/components/canvas/artifacts/XpsProWorkbench.styles'
import type { ProDataTabDef } from '@/components/canvas/artifacts/pro/ProDataTabs'
import type {
  ModuleCtx,
  NormalisedPeak,
  TechniqueModule,
} from '../types'
import type { XpsActions } from './parts/actions'
import { buildOverlays, MainViz } from './parts/MainViz'
import { XpsQuantificationTab } from './parts/QuantificationTab'
import { XPS_VARS_SCHEMA } from './parts/varsSchema'
import {
  buildXpsReport,
  extractElementFromName,
  extractFitComponents,
  extractLineFromName,
} from './parts/helpers'
import { renderXpsFooter } from './parts/Footer'
import { buildXpsCommands } from './parts/commands'

export type { XpsActions } from './parts/actions'
export { buildOverlays } from './parts/MainViz'

// ─── Actions ───────────────────────────────────────────────────────

function useXpsActions(ctx: ModuleCtx<XpsSubState>): XpsActions {
  const { sub, patchShared, patchSubState } = ctx
  const spectrum = ctx.payload.spectrum
  const params = sub.params

  const [busy, setBusy] = useState<string | null>(null)
  const chartExporter = useChartExporter()
  const { focusedPeakIdx, setFocusedPeakIdx } = useFocusedPeak()

  // Plain (non-memoised) async runner — useCallback breaks generic
  // inference on `T`, which would cascade into `unknown`-typed results
  // at every call site. The function has no closure cost worth memoising.
  async function run<T>(
    key: string,
    fn: () => Promise<T>,
    onSuccess: (result: T) => void,
  ): Promise<void> {
    setBusy(key)
    try {
      const res = await fn()
      onSuccess(res)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.error(`${key}: ${message}`)
    } finally {
      setBusy(null)
    }
  }

  const setParams = useCallback(
    (update: (p: XpsProPayload['params']) => XpsProPayload['params']) =>
      patchSubState({ params: update(sub.params) }),
    [patchSubState, sub.params],
  )

  const handleAssessQuality = () =>
    run(
      'quality',
      () => localProSpectrum.assessQuality(spectrum),
      (r: AssessQualityResponse) => {
        if ('grade' in r && r.grade) {
          const q: ProDataQuality = {
            grade: r.grade,
            snr: r.snr,
            nPoints: r.n_points,
            issues: r.issues ?? [],
            recommendations: r.recommendations ?? [],
          }
          patchShared({ quality: q })
        } else if (!('grade' in r) && r.success === false) {
          toast.error(r.error)
        }
      },
    )

  const handleChargeCorrect = () => {
    const t0 = Date.now()
    const snapshot = { chargeCorrect: { ...params.chargeCorrect } }
    return run(
      'charge-correct',
      () =>
        localProXps.chargeCorrect(spectrum, {
          mode: params.chargeCorrect.mode,
          reference_eV: params.chargeCorrect.referenceEV,
          manual_shift: params.chargeCorrect.manualShift,
          search_range: params.chargeCorrect.searchRange,
        }),
      (r: ChargeCorrectResponse) => {
        const durationMs = Date.now() - t0
        if (r.success) {
          patchSubState({
            chargeCorrection: {
              shiftEV: r.shift_eV,
              c1sFoundEV: r.c1s_found_eV,
            },
          })
          toast.success(`Shifted by ${r.shift_eV.toFixed(2)} eV`)
          appendRunRecord(ctx, {
            command: 'xps.charge-correct',
            paramsSummary: `mode=${params.chargeCorrect.mode}, ref=${params.chargeCorrect.referenceEV}eV`,
            resultSummary: `shift ${r.shift_eV.toFixed(2)} eV`,
            paramsSnapshot: snapshot,
            durationMs,
          })
        } else {
          toast.error(r.error)
          appendRunRecord(ctx, {
            command: 'xps.charge-correct',
            paramsSummary: `mode=${params.chargeCorrect.mode}`,
            resultSummary: r.error ?? 'failed',
            paramsSnapshot: snapshot,
            durationMs,
            failed: true,
          })
        }
      },
    )
  }

  const handleDetectPeaks = () => {
    const t0 = Date.now()
    const snapshot = { peakDetect: { ...params.peakDetect } }
    return run(
      'detect-peaks',
      () =>
        localProSpectrum.detectPeaks(spectrum, {
          topk: params.peakDetect.topK,
          prominence_mult: params.peakDetect.prominenceMult,
        }),
      (r: DetectPeaksResponse) => {
        const durationMs = Date.now() - t0
        if (r.success) {
          const peaks: XrdProPeak[] = (r.peaks ?? []).map((p) => ({
            position: Number(p.position ?? 0),
            intensity: Number(p.intensity ?? 0),
            fwhm: p.fwhm != null ? Number(p.fwhm) : undefined,
            snr: p.snr != null ? Number(p.snr) : undefined,
          }))
          patchSubState({ detectedPeaks: peaks })
          toast.success(`Detected ${peaks.length} peaks`)
          appendRunRecord(ctx, {
            command: 'xps.detect-peaks',
            paramsSummary: `top-K ${params.peakDetect.topK}, prominence ×${params.peakDetect.prominenceMult}`,
            resultSummary: `${peaks.length} peaks`,
            paramsSnapshot: snapshot,
            durationMs,
          })
        } else {
          toast.error(r.error)
          appendRunRecord(ctx, {
            command: 'xps.detect-peaks',
            paramsSummary: `top-K ${params.peakDetect.topK}`,
            resultSummary: r.error ?? 'failed',
            paramsSnapshot: snapshot,
            durationMs,
            failed: true,
          })
        }
      },
    )
  }

  const handleRestoreParams = (snapshot: unknown) => {
    if (!snapshot || typeof snapshot !== 'object') return
    const record = snapshot as {
      fit?: Partial<XpsProPayload['params']['fit']>
      energyWindow?: Partial<XpsProPayload['params']['energyWindow']>
      peakDetect?: Partial<XpsProPayload['params']['peakDetect']>
      chargeCorrect?: Partial<XpsProPayload['params']['chargeCorrect']>
      quantify?: Partial<XpsProPayload['params']['quantify']>
      peakDefinitions?: XpsProPeakDef[]
    }
    setParams((p) => ({
      ...p,
      fit: { ...p.fit, ...(record.fit ?? {}) },
      energyWindow: { ...p.energyWindow, ...(record.energyWindow ?? {}) },
      peakDetect: { ...p.peakDetect, ...(record.peakDetect ?? {}) },
      chargeCorrect: { ...p.chargeCorrect, ...(record.chargeCorrect ?? {}) },
      quantify: { ...p.quantify, ...(record.quantify ?? {}) },
    }))
    if (record.peakDefinitions) {
      patchSubState({ peakDefinitions: record.peakDefinitions })
    }
    toast.info('Restored params — click Run when ready')
  }

  const handleUpdateDetectedPeak = (
    idx: number,
    patch: Partial<XrdProPeak>,
  ) => {
    if (idx < 0 || idx >= sub.detectedPeaks.length) return
    const next = sub.detectedPeaks.slice()
    next[idx] = { ...next[idx], ...patch }
    patchSubState({ detectedPeaks: next })
  }

  const handleRemoveDetectedPeak = (idx: number) => {
    const next = sub.detectedPeaks.slice()
    next.splice(idx, 1)
    patchSubState({ detectedPeaks: next })
  }

  const handleAddBlankDetectedPeak = () => {
    const next: XrdProPeak[] = [
      ...sub.detectedPeaks,
      { position: 0, intensity: 0 },
    ]
    patchSubState({ detectedPeaks: next })
  }

  const handleAddPeakDef = (type: 'single' | 'doublet') => {
    const id = `pk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    const def: XpsProPeakDef = {
      id,
      label: type === 'doublet' ? 'Doublet' : 'Peak',
      type,
      position: 285,
      intensity: 1000,
      fwhm: 1.2,
      split: type === 'doublet' ? 5.0 : undefined,
      branchingRatio: type === 'doublet' ? 0.5 : undefined,
      // Seed per-peak η from the workbench default so power users can
      // override it on a per-peak basis without losing the global setting.
      voigtEta: params.fit.voigtEta,
    }
    patchSubState({ peakDefinitions: [...sub.peakDefinitions, def] })
  }

  const handleRemovePeakDef = (id: string) => {
    patchSubState({
      peakDefinitions: sub.peakDefinitions.filter(
        (p: XpsProPeakDef) => p.id !== id,
      ),
    })
  }

  const handleUpdatePeakDef = (
    id: string,
    patchDef: Partial<XpsProPeakDef>,
  ) => {
    patchSubState({
      peakDefinitions: sub.peakDefinitions.map((p: XpsProPeakDef) =>
        p.id === id ? { ...p, ...patchDef } : p,
      ),
    })
  }

  const handleFit = () => {
    // Translate the workbench's local XpsProPeakDef shape to the exact wire
    // format lattice-cli's `_dict_to_peak_spec` expects
    // (tools/xps_fit_spectrum.py:58-73). Mismatched field names here would
    // KeyError out of the backend handler on `d["name"]` / `d["center"]`.
    // Per-peak η overrides the workbench default; the helper lives in
    // `lib/xps-peak-spec-build.ts` so the (often subtle) mapping rules are
    // unit-testable without hydrating the whole workbench.
    const { peaks: peakSpecs, doublets } = buildXpsSpecs(sub.peakDefinitions, {
      defaultVoigtEta: params.fit.voigtEta,
    })
    if (peakSpecs.length === 0 && doublets.length === 0) {
      toast.warn('Define at least one peak or doublet first')
      return
    }
    const energyRange: [number, number] | undefined =
      params.energyWindow.min != null && params.energyWindow.max != null
        ? [params.energyWindow.min, params.energyWindow.max]
        : undefined
    const t0 = Date.now()
    const snapshot = {
      fit: { ...params.fit },
      energyWindow: { ...params.energyWindow },
      peakDefinitions: sub.peakDefinitions.map((p) => ({ ...p })),
    }
    run(
      'fit',
      () =>
        localProXps.fit(spectrum, {
          peaks: peakSpecs,
          doublets: doublets.length > 0 ? doublets : undefined,
          background: params.fit.background,
          method: params.fit.method,
          energy_range: energyRange,
        }),
      (r: XpsFitResponse) => {
        const durationMs = Date.now() - t0
        if (r.success) {
          // Project the worker's snake_case fit diagnostics into the payload
          // type's camelCase shape so the UI layer stays consistent with
          // the rest of the app.
          const stats = r.fit_statistics
          const fitStatistics: XpsProFitResult['fitStatistics'] = stats
            ? {
                reducedChiSquared: stats.reduced_chi_squared,
                rSquared: stats.r_squared,
                nVariables: stats.n_variables,
                nDataPoints: stats.n_data_points,
                success: stats.success,
                message: stats.message,
              }
            : undefined
          const componentAreas = r.components?.map((c) => ({
            name: c.name,
            centerEV: c.center_eV,
            centerErr: c.center_err,
            fwhmEV: c.fwhm_eV,
            fwhmErr: c.fwhm_err,
            area: c.area,
            areaErr: c.area_err,
          }))
          const fitResult: XpsProFitResult = {
            curves: r.curves,
            data: r.data,
            appliedShiftEV: sub.chargeCorrection?.shiftEV,
            fitStatistics,
            warnings: r.warnings,
            correlationWarnings: r.correlation_warnings,
            componentAreas,
          }
          patchSubState({
            fitResult: { ...sub.fitResult, ...fitResult },
          })
          toast.success('Fit complete')
          appendRunRecord(ctx, {
            command: 'xps.fit',
            paramsSummary: `${peakSpecs.length + doublets.length} defs, bg=${params.fit.background}`,
            resultSummary: `${Object.keys(r.curves?.components ?? {}).length} components`,
            paramsSnapshot: snapshot,
            durationMs,
          })
        } else {
          toast.error(r.error)
          appendRunRecord(ctx, {
            command: 'xps.fit',
            paramsSummary: `${peakSpecs.length + doublets.length} defs`,
            resultSummary: r.error ?? 'failed',
            paramsSnapshot: snapshot,
            durationMs,
            failed: true,
          })
        }
      },
    )
  }

  const handleQuantify = () => {
    const elements = params.quantify.elements
      .split(/[,\s]+/)
      .filter(Boolean)
    // Local quantify is stateless — it needs the per-peak element + area
    // pairs explicitly. Pull them from the most recent fit's components;
    // if none, fall back to detected peaks (which won't have areas, so the
    // worker will skip them with a warning).
    const fitComponents = sub.fitResult?.data
      ? extractFitComponents(sub.fitResult.data)
      : extractFitComponents(
          (sub.fitResult as { components?: unknown } | null | undefined)
            ?.components,
        )
    const peakSpecs = fitComponents.map(
      (c: { name: string; area: number }) => ({
        element: extractElementFromName(c.name),
        line: extractLineFromName(c.name),
        area: c.area,
      }),
    )
    const t0 = Date.now()
    const snapshot = { quantify: { ...params.quantify } }
    run(
      'quantify',
      () =>
        localProXps.quantify({
          elements,
          peaks: peakSpecs,
          // `rsfSet` on the UI maps directly to `rsf_set` on the wire —
          // the worker picks the matching catalog from its registry.
          rsf_set: params.quantify.rsfSet,
        }),
      (r: XpsQuantifyResponse) => {
        const durationMs = Date.now() - t0
        if (r.success) {
          const rows =
            (r.data?.atomic_percentages as XpsProFitResult['quantification']) ??
            (r.data?.quantification as XpsProFitResult['quantification']) ??
            []
          patchSubState({
            fitResult: {
              ...(sub.fitResult ?? {}),
              quantification: rows ?? [],
            },
          })
          toast.success(`${rows?.length ?? 0} elements quantified`)
          appendRunRecord(ctx, {
            command: 'xps.quantify',
            paramsSummary: `${elements.length} elements, ${peakSpecs.length} component areas`,
            resultSummary: `${rows?.length ?? 0} rows`,
            paramsSnapshot: snapshot,
            durationMs,
          })
        } else {
          toast.error(r.error)
          appendRunRecord(ctx, {
            command: 'xps.quantify',
            paramsSummary: `${elements.length} elements`,
            resultSummary: r.error ?? 'failed',
            paramsSnapshot: snapshot,
            durationMs,
            failed: true,
          })
        }
      },
    )
  }

  const handleLookup = () => {
    if (sub.detectedPeaks.length === 0) {
      toast.warn('Detect peaks first')
      return
    }
    const t0 = Date.now()
    const snapshot = { lookup: { ...params.lookup } }
    run(
      'lookup',
      () =>
        localProXps.lookup({
          peaks: sub.detectedPeaks.map((p: XrdProPeak) => ({
            position: p.position,
            intensity: p.intensity,
            fwhm: p.fwhm,
            snr: p.snr,
          })),
          tolerance: params.lookup.tolerance,
          charge_correction: sub.chargeCorrection?.shiftEV,
        }),
      (r: XpsLookupResponse) => {
        const durationMs = Date.now() - t0
        if (r.success) {
          const rows =
            (r.data?.assignments as XpsProFitResult['lookupAssignments']) ??
            (r.data?.matches as XpsProFitResult['lookupAssignments']) ??
            []
          patchSubState({
            fitResult: {
              ...(sub.fitResult ?? {}),
              lookupAssignments: rows ?? [],
            },
          })
          toast.success(`Found ${rows?.length ?? 0} assignments`)
          appendRunRecord(ctx, {
            command: 'xps.lookup',
            paramsSummary: `${sub.detectedPeaks.length} peaks, tol ±${params.lookup.tolerance}eV`,
            resultSummary: `${rows?.length ?? 0} assignments`,
            paramsSnapshot: snapshot,
            durationMs,
          })
        } else {
          toast.error(r.error)
          appendRunRecord(ctx, {
            command: 'xps.lookup',
            paramsSummary: `${sub.detectedPeaks.length} peaks`,
            resultSummary: r.error ?? 'failed',
            paramsSnapshot: snapshot,
            durationMs,
            failed: true,
          })
        }
      },
    )
  }

  // Multi-pattern overlay — load secondary XPS spectra alongside the
  // primary data for depth-profile / angle-resolved / before-after
  // comparison. Mirrors the XRD implementation so both workbenches share
  // the same parser pipeline; binary-only formats are rejected because
  // routing them through a filesystem reader is out of scope here.
  const handleAddPatternOverlay = async (file: File) => {
    if (needsBinaryRead(file.name)) {
      toast.warn(
        `${file.name} is a binary format — convert to CSV/XY first, or load it as the primary spectrum.`,
      )
      return
    }
    if (!canParseLocally(file.name)) {
      toast.warn(`Unsupported format: ${file.name}`)
      return
    }
    if (file.size > OVERLAY_MAX_BYTES) {
      toast.warn(
        `${file.name} is ${(file.size / 1e6).toFixed(1)} MB — overlay cap is ${(OVERLAY_MAX_BYTES / 1e6).toFixed(0)} MB. Load it as the primary spectrum instead.`,
      )
      return
    }
    try {
      const text = await file.text()
      const parsed = await parseSpectrumText(text, file.name)
      if (!parsed || parsed.x.length === 0) {
        toast.error(`Could not parse ${file.name}`)
        return
      }
      const current = sub.patternOverlays ?? []
      const id = `ovl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
      const color =
        GRAYSCALE_OVERLAY_COLORS[
          current.length % GRAYSCALE_OVERLAY_COLORS.length
        ]
      const next: XpsPatternOverlay = {
        id,
        name: file.name,
        x: parsed.x,
        y: parsed.y,
        color,
        visible: true,
      }
      patchSubState({ patternOverlays: [...current, next] })
      toast.success(`Loaded ${file.name} (${parsed.x.length} points)`)
    } catch (err) {
      toast.error(
        `Load failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  const handleToggleOverlayVisibility = (id: string) => {
    const current = sub.patternOverlays ?? []
    patchSubState({
      patternOverlays: current.map((o) =>
        o.id === id ? { ...o, visible: !o.visible } : o,
      ),
    })
  }

  const handleRemovePatternOverlay = (id: string) => {
    const current = sub.patternOverlays ?? []
    patchSubState({
      patternOverlays: current.filter((o) => o.id !== id),
    })
  }

  const handleClearPatternOverlays = () => {
    patchSubState({ patternOverlays: [] })
  }

  const handleResetEnergyWindow = () => {
    setParams((p) => ({
      ...p,
      energyWindow: { min: null, max: null },
    }))
  }

  const handleExport = () => {
    const text = buildXpsReport(sub)
    const blob = new Blob([text], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'xps-fit.md'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  return {
    busy,
    chartExporter,
    focusedPeakIdx,
    setFocusedPeakIdx,
    setParams,
    handleAssessQuality,
    handleChargeCorrect,
    handleDetectPeaks,
    handleRestoreParams,
    handleUpdateDetectedPeak,
    handleRemoveDetectedPeak,
    handleAddBlankDetectedPeak,
    handleAddPeakDef,
    handleRemovePeakDef,
    handleUpdatePeakDef,
    handleFit,
    handleQuantify,
    handleLookup,
    handleAddPatternOverlay,
    handleToggleOverlayVisibility,
    handleRemovePatternOverlay,
    handleClearPatternOverlays,
    handleResetEnergyWindow,
    handleExport,
  }
}

// ─── Data tabs ─────────────────────────────────────────────────────

const XPS_PEAK_COLUMNS = [
  { key: 'position', label: 'BE', unit: 'eV', numeric: true, precision: 2, editable: true, step: 0.05 },
  { key: 'intensity', label: 'I', numeric: true, precision: 1, editable: true, step: 1 },
  { key: 'fwhm', label: 'FWHM', unit: 'eV', numeric: true, precision: 2, editable: true, step: 0.05 },
  { key: 'snr', label: 'SNR', numeric: true, precision: 1, editable: false },
] as const satisfies ReadonlyArray<PeakColumnDef<XrdProPeak>>

function buildDataTabs(
  ctx: ModuleCtx<XpsSubState>,
  actions: XpsActions,
): ProDataTabDef[] {
  const { sub } = ctx
  return [
    {
      id: 'peaks',
      label: 'Detected peaks',
      badge: sub.detectedPeaks.length || undefined,
      content: (
        <ProPeakTable<XrdProPeak>
          peaks={sub.detectedPeaks}
          columns={XPS_PEAK_COLUMNS}
          onEdit={actions.handleUpdateDetectedPeak}
          onDelete={actions.handleRemoveDetectedPeak}
          onAdd={actions.handleAddBlankDetectedPeak}
          onFocus={actions.setFocusedPeakIdx}
          emptyMessage="No detected peaks — run detect-peaks or add a row."
        />
      ),
    },
    {
      id: 'defs',
      label: 'Peak defs',
      badge: sub.peakDefinitions.length || undefined,
      content: (
        <div style={S.tabPlaceholder}>
          {sub.peakDefinitions.length} peak definitions. Edit them in the
          Inspector (Peak Definitions section).
        </div>
      ),
    },
    {
      id: 'fit',
      label: 'Fit',
      badge: sub.fitResult?.curves ? 'done' : undefined,
      content: (
        <div style={S.tabPlaceholder}>
          {sub.fitResult?.curves
            ? 'Envelope / components / residual are rendered on the chart.'
            : 'Run fit to populate envelope + residual overlays.'}
        </div>
      ),
    },
    {
      id: 'quant',
      label: 'Quantification',
      badge: sub.fitResult?.quantification?.length || undefined,
      content: (
        <XpsQuantificationTab rows={sub.fitResult?.quantification ?? []} />
      ),
    },
    {
      id: 'vars',
      label: 'Vars',
      content: <ProVarsTab<XpsSubState> schema={XPS_VARS_SCHEMA} ctx={ctx} />,
    },
  ]
}

// ─── Inspector ────────────────────────────────────────────────────

function renderInspector(
  ctx: ModuleCtx<XpsSubState>,
  actions: XpsActions,
): ReactNode {
  // Synthesise the legacy panel's `payload` prop from sub + shared. The
  // panel only reads a handful of top-level fields; keeping the projection
  // local is simpler than refactoring the panel's API in this phase.
  const syntheticPayload: XpsProPayload = {
    params: ctx.sub.params,
    detectedPeaks: ctx.sub.detectedPeaks,
    peakDefinitions: ctx.sub.peakDefinitions,
    chargeCorrection: ctx.sub.chargeCorrection,
    fitResult: ctx.sub.fitResult,
    patternOverlays: ctx.sub.patternOverlays,
    spectrum: ctx.payload.spectrum,
    quality: ctx.payload.quality,
    status: ctx.payload.status,
    lastError: ctx.payload.lastError,
  }
  return (
    <XpsParameterPanel
      payload={syntheticPayload}
      params={ctx.sub.params}
      busy={actions.busy}
      setParams={actions.setParams}
      onAssessQuality={actions.handleAssessQuality}
      onChargeCorrect={actions.handleChargeCorrect}
      onDetectPeaks={actions.handleDetectPeaks}
      onAddPeakDef={actions.handleAddPeakDef}
      onRemovePeakDef={actions.handleRemovePeakDef}
      onUpdatePeakDef={actions.handleUpdatePeakDef}
      onFit={actions.handleFit}
      onQuantify={actions.handleQuantify}
      onLookup={actions.handleLookup}
      onAddPatternOverlay={actions.handleAddPatternOverlay}
      onToggleOverlayVisibility={actions.handleToggleOverlayVisibility}
      onRemovePatternOverlay={actions.handleRemovePatternOverlay}
    />
  )
}

// ─── Defaults + peak normaliser ───────────────────────────────────

function defaultSubState(): XpsSubState {
  // Strip the shared fields from the full-payload factory so the module's
  // default matches what `SpectrumProPayload.xps` carries.
  const {
    spectrum: _spectrum,
    quality: _quality,
    status: _status,
    lastError: _lastError,
    ...sub
  } = defaultXpsProPayload()
  return sub
}

function peaksFromSub(sub: XpsSubState): NormalisedPeak[] {
  return sub.detectedPeaks
}

// ─── Module ───────────────────────────────────────────────────────

export const XpsModule: TechniqueModule<XpsSubState, XpsActions> = {
  technique: 'xps',
  label: 'XPS',
  defaultSubState,
  useActions: useXpsActions,
  buildOverlays,
  renderMainViz: (ctx, actions) => <MainViz ctx={ctx} actions={actions} />,
  buildDataTabs,
  renderInspector,
  renderFooter: renderXpsFooter,
  commands: buildXpsCommands,
  peaksFromSub,
}

export default XpsModule
