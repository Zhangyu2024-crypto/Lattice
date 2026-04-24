// Raman (and FTIR) technique module — the RamanProWorkbench feature
// surface decomposed into the `TechniqueModule` interface so a single
// module serves both techniques. Which lens is active is decided by
// `sub.params.mode` (`'raman' | 'ftir'`); the registry will bind the
// same module instance to both `SpectrumTechnique` keys. All handlers
// funnel through `ModuleCtx.patchShared` / `patchSubState` so the
// module is payload-shape-agnostic — the unified adapter layer decides
// whether those writes land on `payload.raman.*` (spectrum-pro) or on
// the top-level legacy payload fields (raman-pro).
//
// The render-only pieces (main chart, data tabs, vars schema, footer,
// commands, CSV helper) live in `./parts/*` — keeping this file focused
// on the action hook and the module wiring.

import { useState, type ReactNode } from 'react'
import type {
  ProDataQuality,
  RamanProMatch,
  RamanProPayload,
  RamanSubState,
  XrdProPeak,
} from '@/types/artifact'
import type {
  AssessQualityResponse,
  BaselineResponse,
  DetectPeaksResponse,
  ProPeak,
  RamanIdentifyResponse,
  RamanMatch,
  SmoothResponse,
} from '@/types/pro-api'
import { localProRaman } from '@/lib/local-pro-raman'
import { localProSpectrum } from '@/lib/local-pro-spectrum'
import { toast } from '@/stores/toast-store'
import { defaultRamanProPayload } from '@/lib/pro-workbench'
import { appendRunRecord } from '@/lib/pro-run-history'
import { useChartExporter } from '@/hooks/useChartExporter'
import { useFocusedPeak } from '@/hooks/useFocusedPeak'
import {
  useProApi,
  ProBackendNotReadyError,
} from '@/hooks/useProApi'
import RamanParameterPanel from '@/components/canvas/artifacts/RamanProWorkbench.panel'
import type {
  ModuleCtx,
  NormalisedPeak,
  TechniqueModule,
} from '../types'
import type { RamanActions } from './parts/actions'
import { buildOverlays, MainViz } from './parts/MainViz'
import { buildRamanDataTabs } from './parts/DataTabs'
import { renderRamanFooter } from './parts/Footer'
import { buildRamanCommands } from './parts/commands'
import { buildPeaksCsv } from './parts/helpers'

export type { RamanActions } from './parts/actions'
export { buildOverlays } from './parts/MainViz'

// ─── Actions ───────────────────────────────────────────────────────

function useRamanActions(ctx: ModuleCtx<RamanSubState>): RamanActions {
  const { sub, patchShared, patchSubState } = ctx
  const spectrum = ctx.payload.spectrum
  const params = sub.params
  const isFtir = params.mode === 'ftir'
  const pro = useProApi()

  const [busy, setBusy] = useState<string | null>(null)
  const chartExporter = useChartExporter()
  const { focusedPeakIdx, setFocusedPeakIdx } = useFocusedPeak()

  // Plain (non-memoised) async runner — `useCallback` breaks generic
  // inference on `T`, which would cascade into `unknown`-typed results
  // at every call site. Cheap to recreate per render.
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
      if (err instanceof ProBackendNotReadyError) {
        toast.warn('Backend not ready')
      } else {
        const message = err instanceof Error ? err.message : String(err)
        toast.error(`${key} failed: ${message}`)
      }
    } finally {
      setBusy(null)
    }
  }

  // Plain closures over the current render — explicit
  // `: RamanActions['handleX']` type annotations would pin the return
  // type to `void` and then `run<T>`'s T gets inferred as `unknown`.
  const setParams = (
    update: (p: RamanProPayload['params']) => RamanProPayload['params'],
  ) => patchSubState({ params: update(params) })

  const handleAssessQuality = () =>
    run(
      'quality',
      () => localProSpectrum.assessQuality(spectrum),
      (r: AssessQualityResponse) => {
        if ('grade' in r && r.grade) {
          const quality: ProDataQuality = {
            grade: r.grade,
            snr: r.snr,
            nPoints: r.n_points,
            issues: r.issues ?? [],
            recommendations: r.recommendations ?? [],
          }
          patchShared({ quality })
        } else if (!('grade' in r) && r.success === false) {
          toast.error(r.error)
        }
      },
    )

  // Smooth / baseline still go through REST — the backend owns an
  // undo stack for these; migrating stateful history to the local
  // worker is out of scope for the UI-completeness sweep.
  const handleSmooth = () => {
    const t0 = Date.now()
    const snapshot = { smooth: { ...params.smooth } }
    return run(
      'smooth',
      () =>
        pro.smooth({
          algorithm: 'savitzky-golay',
          window_length: params.smooth.sgWindow,
          polyorder: params.smooth.sgOrder,
        }),
      (r: SmoothResponse) => {
        const durationMs = Date.now() - t0
        if (r.success) {
          toast.success('Smoothed')
          appendRunRecord(ctx, {
            command: `${isFtir ? 'ftir' : 'raman'}.smooth`,
            paramsSummary: `SG window ${params.smooth.sgWindow}, order ${params.smooth.sgOrder}`,
            resultSummary: 'ok',
            paramsSnapshot: snapshot,
            durationMs,
          })
        } else {
          toast.error(r.error)
          appendRunRecord(ctx, {
            command: `${isFtir ? 'ftir' : 'raman'}.smooth`,
            paramsSummary: `SG window ${params.smooth.sgWindow}`,
            resultSummary: r.error ?? 'failed',
            paramsSnapshot: snapshot,
            durationMs,
            failed: true,
          })
        }
      },
    )
  }

  const handleBaseline = () => {
    const t0 = Date.now()
    const snapshot = { baseline: { ...params.baseline } }
    return run(
      'baseline',
      () =>
        pro.baseline({
          method: params.baseline.method,
        }),
      (r: BaselineResponse) => {
        const durationMs = Date.now() - t0
        if (r.success) {
          toast.success('Baseline corrected')
          appendRunRecord(ctx, {
            command: `${isFtir ? 'ftir' : 'raman'}.baseline`,
            paramsSummary: `method=${params.baseline.method}`,
            resultSummary: 'ok',
            paramsSnapshot: snapshot,
            durationMs,
          })
        } else {
          toast.error(r.error)
          appendRunRecord(ctx, {
            command: `${isFtir ? 'ftir' : 'raman'}.baseline`,
            paramsSummary: `method=${params.baseline.method}`,
            resultSummary: r.error ?? 'failed',
            paramsSnapshot: snapshot,
            durationMs,
            failed: true,
          })
        }
      },
    )
  }

  const handleUpdatePeak = (idx: number, patch: Partial<XrdProPeak>) => {
    if (idx < 0 || idx >= sub.peaks.length) return
    const next = sub.peaks.slice()
    next[idx] = { ...next[idx], ...patch }
    patchSubState({ peaks: next })
  }
  const handleRemovePeak = (idx: number) => {
    const next = sub.peaks.slice()
    next.splice(idx, 1)
    patchSubState({ peaks: next })
  }
  const handleAddBlankPeak = () => {
    const next: XrdProPeak[] = [...sub.peaks, { position: 0, intensity: 0 }]
    patchSubState({ peaks: next })
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
          const peaks: XrdProPeak[] = (r.peaks ?? []).map((p: ProPeak) => ({
            position: Number(p.position ?? 0),
            intensity: Number(p.intensity ?? 0),
            fwhm: p.fwhm != null ? Number(p.fwhm) : undefined,
            snr: p.snr != null ? Number(p.snr) : undefined,
          }))
          patchSubState({ peaks })
          toast.success(`${peaks.length} peaks`)
          appendRunRecord(ctx, {
            command: `${isFtir ? 'ftir' : 'raman'}.detect-peaks`,
            paramsSummary: `top-K ${params.peakDetect.topK}, prominence ×${params.peakDetect.prominenceMult}`,
            resultSummary: `${peaks.length} peaks`,
            paramsSnapshot: snapshot,
            durationMs,
          })
        } else {
          toast.error(r.error)
          appendRunRecord(ctx, {
            command: `${isFtir ? 'ftir' : 'raman'}.detect-peaks`,
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

  const handleIdentify = () => {
    if (sub.peaks.length === 0) {
      toast.warn('Detect peaks first')
      return
    }
    // FTIR identify is gated at the UI + command-palette layer via
    // `getCapability('ftir-identify')`. If execution reaches here in FTIR
    // mode, the gate was bypassed programmatically; noop defensively.
    if (isFtir) return
    const t0 = Date.now()
    const snapshot = { assignment: { ...params.assignment } }
    return run(
      'identify',
      () =>
        localProRaman.identify({
          peaks: sub.peaks.map((p: XrdProPeak) => ({
            position: p.position,
            intensity: p.intensity,
            fwhm: p.fwhm,
          })),
          tolerance: params.assignment.tolerance,
        }),
      (r: RamanIdentifyResponse) => {
        const durationMs = Date.now() - t0
        if (r.success) {
          const matches: RamanProMatch[] = (r.data?.matches ?? []).map(
            (m: RamanMatch) => ({
              name: m.name,
              formula: m.formula,
              score: m.score,
              matchedPeaks: m.matched_peaks,
              referencePeaks: Array.isArray(m.reference_peaks)
                ? (m.reference_peaks as number[])
                : undefined,
            }),
          )
          patchSubState({ matches })
          toast.success(`${matches.length} matches`)
          appendRunRecord(ctx, {
            command: 'raman.identify',
            paramsSummary: `${sub.peaks.length} peaks, tol ±${params.assignment.tolerance} cm⁻¹`,
            resultSummary:
              matches.length > 0
                ? `${matches.length} matches, top: ${matches[0].name}`
                : 'no matches',
            paramsSnapshot: snapshot,
            durationMs,
          })
        } else {
          toast.error(r.error)
          appendRunRecord(ctx, {
            command: 'raman.identify',
            paramsSummary: `${sub.peaks.length} peaks`,
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
      smooth?: Partial<RamanProPayload['params']['smooth']>
      baseline?: Partial<RamanProPayload['params']['baseline']>
      peakDetect?: Partial<RamanProPayload['params']['peakDetect']>
      assignment?: Partial<RamanProPayload['params']['assignment']>
    }
    setParams((p) => ({
      ...p,
      smooth: { ...p.smooth, ...(record.smooth ?? {}) },
      baseline: { ...p.baseline, ...(record.baseline ?? {}) },
      peakDetect: { ...p.peakDetect, ...(record.peakDetect ?? {}) },
      assignment: { ...p.assignment, ...(record.assignment ?? {}) },
    }))
    toast.info('Restored params — click Run when ready')
  }

  const handleExport = () => {
    if (sub.peaks.length === 0) {
      toast.warn('No peaks to export')
      return
    }
    const blob = new Blob([buildPeaksCsv(sub.peaks)], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${params.mode}-peaks.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  return {
    busy,
    isFtir,
    chartExporter,
    focusedPeakIdx,
    setFocusedPeakIdx,
    setParams,
    handleAssessQuality,
    handleSmooth,
    handleBaseline,
    handleDetectPeaks,
    handleUpdatePeak,
    handleRemovePeak,
    handleAddBlankPeak,
    handleIdentify,
    handleRestoreParams,
    handleExport,
  }
}

// ─── Inspector ────────────────────────────────────────────────────

function renderInspector(
  ctx: ModuleCtx<RamanSubState>,
  actions: RamanActions,
): ReactNode {
  // Synthesise the legacy panel's `payload` prop from sub + shared —
  // the panel only reads `quality`, `peaks`, `matches` and `params`
  // so we don't need to refactor its API this phase.
  const syntheticPayload: RamanProPayload = {
    params: ctx.sub.params,
    peaks: ctx.sub.peaks,
    matches: ctx.sub.matches,
    spectrum: ctx.payload.spectrum,
    quality: ctx.payload.quality,
    status: ctx.payload.status,
    lastError: ctx.payload.lastError,
  }
  return (
    <RamanParameterPanel
      payload={syntheticPayload}
      params={ctx.sub.params}
      busy={actions.busy}
      isFtir={actions.isFtir}
      setParams={actions.setParams}
      onAssessQuality={actions.handleAssessQuality}
      onSmooth={actions.handleSmooth}
      onBaseline={actions.handleBaseline}
      onDetectPeaks={actions.handleDetectPeaks}
      onIdentify={actions.handleIdentify}
    />
  )
}

// ─── Defaults + peak normaliser ───────────────────────────────────

function defaultSubState(): RamanSubState {
  // Strip the shared fields from the full-payload factory so the
  // module's default matches what `SpectrumProPayload.raman` carries.
  const {
    spectrum: _spectrum,
    quality: _quality,
    status: _status,
    lastError: _lastError,
    ...sub
  } = defaultRamanProPayload()
  return sub
}

function peaksFromSub(sub: RamanSubState): NormalisedPeak[] {
  return sub.peaks
}

// ─── Module ───────────────────────────────────────────────────────

export const RamanModule: TechniqueModule<RamanSubState, RamanActions> = {
  // The unified registry maps BOTH `raman` and `ftir` to this instance;
  // we nominally declare `'raman'` here and branch behaviour through
  // `sub.params.mode` (surfaced as `actions.isFtir`).
  technique: 'raman',
  label: 'Raman',
  defaultSubState,
  useActions: useRamanActions,
  buildOverlays,
  renderMainViz: (ctx, actions) => <MainViz ctx={ctx} actions={actions} />,
  buildDataTabs: buildRamanDataTabs,
  renderInspector,
  renderFooter: renderRamanFooter,
  commands: buildRamanCommands,
  peaksFromSub,
}

export default RamanModule
