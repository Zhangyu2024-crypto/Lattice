// Curve technique module — the CurveProWorkbench feature surface decomposed
// into the `TechniqueModule` interface so it's mountable both by the
// legacy `CurveProWorkbench` shim and the Phase-3 UnifiedProWorkbench.
//
// Curve is the generic X-Y preprocessing lens (smooth → baseline → peak
// detection). It has no fit, no assignment, and no lookup — just the
// shared preprocessing primitives from `local-pro-spectrum`.
//
// The render-only pieces (main chart, data tabs, vars schema, footer,
// commands, CSV helper) live in `./parts/*` — keeping this file focused
// on the action hook and the module wiring.

import { useState, type ReactNode } from 'react'
import type {
  CurveFeature,
  CurveProPayload,
  CurveSubState,
  ProDataQuality,
} from '@/types/artifact'
import type { AssessQualityResponse, DetectPeaksResponse } from '@/types/pro-api'
import {
  localProSpectrum,
  type BaselineResponse,
  type SmoothResponse,
} from '@/lib/local-pro-spectrum'
import { toast } from '@/stores/toast-store'
import { defaultCurveProPayload } from '@/lib/pro-workbench'
import { downloadTextFile } from '@/lib/pro-export'
import { useChartExporter } from '@/hooks/useChartExporter'
import { useFocusedPeak } from '@/hooks/useFocusedPeak'
import { appendRunRecord } from '@/lib/pro-run-history'
import CurveParameterPanel from './panel'
import type { ModuleCtx, TechniqueModule } from '../types'
import type { CurveActions } from './parts/actions'
import { buildOverlays, MainViz } from './parts/MainViz'
import { buildCurveDataTabs } from './parts/DataTabs'
import { renderCurveFooter } from './parts/Footer'
import { buildCurveCommands } from './parts/commands'
import { buildFeaturesCsv, peaksFromSub } from './parts/helpers'

export type { CurveActions } from './parts/actions'
export { buildOverlays } from './parts/MainViz'

// ─── Actions ───────────────────────────────────────────────────────

function useCurveActions(ctx: ModuleCtx<CurveSubState>): CurveActions {
  const { sub, patchShared, patchSubState } = ctx
  const spectrum = ctx.payload.spectrum

  const [busy, setBusy] = useState<string | null>(null)
  const chartExporter = useChartExporter()
  const { focusedPeakIdx, setFocusedPeakIdx } = useFocusedPeak()

  // Plain (non-memoised) async runner — `useCallback` would collapse the
  // `T` generic inference to `unknown`, breaking the typed `(r) => …`
  // callbacks at every call site.
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
      toast.error(`${key} failed: ${message}`)
    } finally {
      setBusy(null)
    }
  }

  // Plain closures (see comment in xrd/index.tsx) — no explicit return
  // type annotations so `run<T>` stays generic.
  const setParams = (
    update: (p: CurveProPayload['params']) => CurveProPayload['params'],
  ) => patchSubState({ params: update(sub.params) })

  const handleAssessQuality = () =>
    run(
      'assess-quality',
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
          toast.success(`Quality: ${quality.grade}`)
        } else if (!('grade' in r) && r.success === false) {
          toast.error(r.error)
        }
      },
    )

  const handleSmooth = () => {
    const t0 = Date.now()
    const snapshot = { smooth: { ...sub.params.smooth } }
    return run(
      'smooth',
      () =>
        localProSpectrum.smooth(spectrum, {
          method: sub.params.smooth.method,
          window: sub.params.smooth.window,
          order: sub.params.smooth.order,
          sigma: sub.params.smooth.sigma,
        }),
      (r: SmoothResponse) => {
        const durationMs = Date.now() - t0
        if (!r.success) {
          toast.error(r.error)
          appendRunRecord(ctx, {
            command: 'curve.smooth',
            paramsSummary: `method=${sub.params.smooth.method}`,
            resultSummary: r.error ?? 'failed',
            paramsSnapshot: snapshot,
            durationMs,
            failed: true,
          })
          return
        }
        if (spectrum) {
          patchShared({ spectrum: { ...spectrum, y: r.y } })
          patchSubState({ processedY: r.y })
        }
        toast.success(`Smoothed (${sub.params.smooth.method})`)
        appendRunRecord(ctx, {
          command: 'curve.smooth',
          paramsSummary: `method=${sub.params.smooth.method}, window=${sub.params.smooth.window}`,
          resultSummary: 'ok',
          paramsSnapshot: snapshot,
          durationMs,
        })
      },
    )
  }

  const handleBaseline = () => {
    const t0 = Date.now()
    const snapshot = { baseline: { ...sub.params.baseline } }
    return run(
      'baseline',
      () =>
        localProSpectrum.baseline(spectrum, {
          method: sub.params.baseline.method,
          order: sub.params.baseline.order,
          iterations: sub.params.baseline.iterations,
        }),
      (r: BaselineResponse) => {
        const durationMs = Date.now() - t0
        if (!r.success) {
          toast.error(r.error)
          appendRunRecord(ctx, {
            command: 'curve.baseline',
            paramsSummary: `method=${sub.params.baseline.method}`,
            resultSummary: r.error ?? 'failed',
            paramsSnapshot: snapshot,
            durationMs,
            failed: true,
          })
          return
        }
        if (spectrum) {
          patchShared({ spectrum: { ...spectrum, y: r.y } })
          patchSubState({ processedY: r.y })
        }
        toast.success(`Baseline corrected (${sub.params.baseline.method})`)
        appendRunRecord(ctx, {
          command: 'curve.baseline',
          paramsSummary: `method=${sub.params.baseline.method}, order=${sub.params.baseline.order}`,
          resultSummary: 'ok',
          paramsSnapshot: snapshot,
          durationMs,
        })
      },
    )
  }

  const handleDetectPeaks = () => {
    const t0 = Date.now()
    const snapshot = { peakDetect: { ...sub.params.peakDetect } }
    return run(
      'detect-peaks',
      () =>
        localProSpectrum.detectPeaks(spectrum, {
          topk: sub.params.peakDetect.topK,
          prominence_mult: sub.params.peakDetect.prominenceMult,
        }),
      (r: DetectPeaksResponse) => {
        const durationMs = Date.now() - t0
        if (!r.success) {
          toast.error(r.error)
          appendRunRecord(ctx, {
            command: 'curve.detect-peaks',
            paramsSummary: `top-K ${sub.params.peakDetect.topK}`,
            resultSummary: r.error ?? 'failed',
            paramsSnapshot: snapshot,
            durationMs,
            failed: true,
          })
          return
        }
        const peaks: CurveFeature[] = (r.peaks ?? []).map(
          (p): CurveFeature => ({
            position: Number(p.position ?? 0),
            intensity: Number(p.intensity ?? 0),
            fwhm: p.fwhm != null ? Number(p.fwhm) : undefined,
          }),
        )
        patchSubState({ peaks })
        toast.success(`Detected ${peaks.length} features`)
        appendRunRecord(ctx, {
          command: 'curve.detect-peaks',
          paramsSummary: `top-K ${sub.params.peakDetect.topK}, prominence ×${sub.params.peakDetect.prominenceMult}`,
          resultSummary: `${peaks.length} features`,
          paramsSnapshot: snapshot,
          durationMs,
        })
      },
    )
  }

  const handleRestoreParams = (snapshot: unknown) => {
    if (!snapshot || typeof snapshot !== 'object') return
    const record = snapshot as {
      smooth?: Partial<CurveProPayload['params']['smooth']>
      baseline?: Partial<CurveProPayload['params']['baseline']>
      peakDetect?: Partial<CurveProPayload['params']['peakDetect']>
    }
    setParams((p) => ({
      ...p,
      smooth: { ...p.smooth, ...(record.smooth ?? {}) },
      baseline: { ...p.baseline, ...(record.baseline ?? {}) },
      peakDetect: { ...p.peakDetect, ...(record.peakDetect ?? {}) },
    }))
    toast.info('Restored params — click Run when ready')
  }

  const handleUpdateFeature = (
    idx: number,
    patch: Partial<CurveFeature>,
  ) => {
    if (idx < 0 || idx >= sub.peaks.length) return
    const next = sub.peaks.slice()
    next[idx] = { ...next[idx], ...patch }
    patchSubState({ peaks: next })
  }
  const handleRemoveFeature = (idx: number) => {
    const next = sub.peaks.slice()
    next.splice(idx, 1)
    patchSubState({ peaks: next })
  }
  const handleAddBlankFeature = () => {
    const next: CurveFeature[] = [
      ...sub.peaks,
      { position: 0, intensity: 0 },
    ]
    patchSubState({ peaks: next })
  }

  const handleExport = () => {
    if (sub.peaks.length === 0) {
      toast.warn('No features to export — run Detect first.')
      return
    }
    const csv = buildFeaturesCsv(sub.peaks)
    const base = spectrum?.sourceFile
      ? spectrum.sourceFile.replace(/\.[^.]+$/, '')
      : 'curve'
    downloadTextFile(`${base}-features.csv`, csv)
    toast.success(`Exported ${sub.peaks.length} features`)
  }

  return {
    busy,
    chartExporter,
    focusedPeakIdx,
    setFocusedPeakIdx,
    setParams,
    handleAssessQuality,
    handleSmooth,
    handleBaseline,
    handleDetectPeaks,
    handleRestoreParams,
    handleUpdateFeature,
    handleRemoveFeature,
    handleAddBlankFeature,
    handleExport,
  }
}

// ─── Inspector ────────────────────────────────────────────────────

function renderInspector(
  ctx: ModuleCtx<CurveSubState>,
  actions: CurveActions,
): ReactNode {
  // Mirrors the XRD module: synthesise the panel's `payload` prop from
  // sub + shared so the panel reads a single CurveProPayload view.
  const syntheticPayload: CurveProPayload = {
    params: ctx.sub.params,
    peaks: ctx.sub.peaks,
    processedY: ctx.sub.processedY,
    spectrum: ctx.payload.spectrum,
    quality: ctx.payload.quality,
    status: ctx.payload.status,
    lastError: ctx.payload.lastError,
  }
  return (
    <CurveParameterPanel
      payload={syntheticPayload}
      params={ctx.sub.params}
      busy={actions.busy}
      setParams={actions.setParams}
      onAssessQuality={actions.handleAssessQuality}
      onSmooth={actions.handleSmooth}
      onBaseline={actions.handleBaseline}
      onDetectPeaks={actions.handleDetectPeaks}
    />
  )
}

// ─── Defaults + peak normaliser ───────────────────────────────────

function defaultSubState(): CurveSubState {
  // Strip the shared fields from the full-payload factory so the module's
  // default matches what `SpectrumProPayload.curve` carries.
  const {
    spectrum: _spectrum,
    quality: _quality,
    status: _status,
    lastError: _lastError,
    ...sub
  } = defaultCurveProPayload()
  return sub
}

// ─── Module ───────────────────────────────────────────────────────

export const CurveModule: TechniqueModule<CurveSubState, CurveActions> = {
  technique: 'curve',
  label: 'Curve',
  defaultSubState,
  useActions: useCurveActions,
  buildOverlays,
  renderMainViz: (ctx, actions) => <MainViz ctx={ctx} actions={actions} />,
  buildDataTabs: buildCurveDataTabs,
  renderInspector,
  renderFooter: renderCurveFooter,
  commands: buildCurveCommands,
  peaksFromSub,
}

export default CurveModule
