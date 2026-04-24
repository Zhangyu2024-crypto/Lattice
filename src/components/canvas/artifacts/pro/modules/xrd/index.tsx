// XRD technique module — the XrdProWorkbench feature surface decomposed
// into the `TechniqueModule` interface so it's mountable both by the
// legacy `XrdProWorkbench` shim and the Phase-3 UnifiedProWorkbench. All
// handlers funnel through `ModuleCtx.patchShared` / `patchSubState`, so
// the module is payload-shape-agnostic — the unified workbench's adapter
// decides whether those writes land on `payload.xrd.*` (spectrum-pro) or
// on the top-level legacy payload fields (xrd-pro).
//
// The render-only pieces (main chart, data tabs, vars schema, footer,
// commands, CSV helper) live in `./parts/*` — keeping this file focused
// on the action hook and the module wiring.

import { useCallback, useState } from 'react'
import type {
  XrdProArtifact,
  XrdProCandidate,
  XrdProPayload,
  XrdProPeak,
  XrdProRefineResult,
  XrdSubState,
} from '@/types/artifact'
import type {
  AssessQualityResponse,
  DetectPeaksResponse,
  XrdRefineResponse,
} from '@/types/pro-api'
import { localProSpectrum } from '@/lib/local-pro-spectrum'
import { localProXrd } from '@/lib/local-pro-xrd'
import { fetchCifsForMaterialIds } from '@/lib/xrd-cif-fetch'
import { identifyPhases } from '@/lib/xrd-phase-identification'
import {
  canParseLocally,
  needsBinaryRead,
  OVERLAY_MAX_BYTES,
  parseSpectrumText,
} from '@/lib/parsers/parse-spectrum-file'
import type { XrdPatternOverlay } from '@/types/artifact'
import { toast } from '@/stores/toast-store'
import { GRAYSCALE_OVERLAY_COLORS } from '@/lib/chart-colors'
import {
  defaultXrdProPayload,
  snapshotXrdWorkbench,
} from '@/lib/pro-workbench'
import { useChartExporter } from '@/hooks/useChartExporter'
import { downloadTextFile } from '@/lib/pro-export'
import { useFocusedPeak } from '@/hooks/useFocusedPeak'
import { appendRunRecord } from '@/lib/pro-run-history'
import { REFINE_PRESETS } from '@/components/canvas/artifacts/XrdProWorkbench.panel'
import type { ProDataTabDef } from '@/components/canvas/artifacts/pro/ProDataTabs'
import type {
  ModuleCtx,
  NormalisedPeak,
  TechniqueModule,
} from '../types'
import type { XrdActions } from './parts/actions'
import { buildOverlays, MainViz } from './parts/MainViz'
import {
  XrdCrystalliteTab,
  XrdFitTab,
  XrdPeaksTab,
  XrdPhasesTab,
  XrdQualityTab,
} from './parts/DataTabs'
import { buildPeaksCsv, buildRefineReportCsv, buildRefineCurveCsv, buildRefinedCif } from './parts/helpers'
import { buildXrdCommands } from './parts/commands'
import XrdToolbar from './parts/Toolbar'

export type { XrdActions } from './parts/actions'
export { buildOverlays } from './parts/MainViz'

// ─── Helpers ──────────────────────────────────────────────────────

function downloadBlob(content: string, filename: string, mime: string): void {
  downloadTextFile(filename, content, mime)
}

function hasUsableCif(
  cif: { path?: string; content?: string } | null | undefined,
): boolean {
  return (
    (typeof cif?.path === 'string' && cif.path.length > 0) ||
    (typeof cif?.content === 'string' && cif.content.length > 0)
  )
}

// ─── Actions ─────────────────────────────────────────���─────────────

function useXrdActions(ctx: ModuleCtx<XrdSubState>): XrdActions {
  const { sub, patchShared, patchSubState } = ctx
  const spectrum = ctx.payload.spectrum

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
      toast.error(`${key} failed: ${message}`)
    } finally {
      setBusy(null)
    }
  }

  // Plain closures over the current render — cheap to recreate and keep
  // TS generic inference happy (explicit `: XrdActions['handleX']` type
  // annotations would pin the return type to `void` and then `run<T>`'s
  // T gets inferred as `unknown` at every call site).
  const setParams = useCallback(
    (update: (p: XrdProPayload['params']) => XrdProPayload['params']) =>
      patchSubState({ params: update(sub.params) }),
    [patchSubState, sub.params],
  )

  const handleAssessQuality = () =>
    run(
      'assess-quality',
      () => localProSpectrum.assessQuality(spectrum),
      (r: AssessQualityResponse) => {
        if ('grade' in r && r.grade) {
          patchShared({
            quality: {
              grade: r.grade,
              snr: r.snr,
              nPoints: r.n_points,
              issues: r.issues ?? [],
              recommendations: r.recommendations ?? [],
            },
          })
          toast.success(`Quality: ${r.grade}`)
        } else if (!('grade' in r) && r.success === false) {
          toast.error(r.error)
        }
      },
    )

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
        if (r.success) {
          const peaks: XrdProPeak[] = (r.peaks ?? []).map((p) => ({
            position: Number(p.position ?? 0),
            intensity: Number(p.intensity ?? 0),
            fwhm: p.fwhm != null ? Number(p.fwhm) : undefined,
            snr: p.snr != null ? Number(p.snr) : undefined,
          }))
          patchSubState({ peaks })
          toast.success(`Detected ${peaks.length} peaks`)
          appendRunRecord(ctx, {
            command: 'xrd.detect-peaks',
            paramsSummary: `top-K ${sub.params.peakDetect.topK}, prominence ×${sub.params.peakDetect.prominenceMult}`,
            resultSummary: `${peaks.length} peaks`,
            paramsSnapshot: snapshot,
            durationMs,
          })
        } else {
          toast.error(r.error)
          appendRunRecord(ctx, {
            command: 'xrd.detect-peaks',
            paramsSummary: `top-K ${sub.params.peakDetect.topK}`,
            resultSummary: r.error ?? 'failed',
            paramsSnapshot: snapshot,
            durationMs,
            failed: true,
          })
        }
      },
    )
  }

  const handleClearPeaks = () => {
    patchSubState({ peaks: [] })
    toast.success('Cleared peaks')
  }

  const handleManualAddPeak = (position: number, intensity: number) => {
    if (!Number.isFinite(position)) return
    const next: XrdProPeak[] = [...sub.peaks, { position, intensity }]
    next.sort((a, b) => a.position - b.position)
    patchSubState({ peaks: next })
  }

  const handleRemovePeak = (i: number) => {
    const next = sub.peaks.slice()
    next.splice(i, 1)
    patchSubState({ peaks: next })
  }

  const handleUpdatePeak = (idx: number, patch: Partial<XrdProPeak>) => {
    if (idx < 0 || idx >= sub.peaks.length) return
    const next = sub.peaks.slice()
    next[idx] = { ...next[idx], ...patch }
    patchSubState({ peaks: next })
  }

  const handleAddBlankPeak = () => {
    // Insert an empty row at the end — user edits it into shape inline.
    // Not re-sorted here; user may be mid-edit and a resort would scramble
    // their row focus. Sorting happens on the next run of detect-peaks.
    const next: XrdProPeak[] = [...sub.peaks, { position: 0, intensity: 0 }]
    patchSubState({ peaks: next })
  }

  const handleSearchDb = () => {
    const elements = sub.params.phaseSearch.elements
      .split(/[,\s]+/)
      .filter(Boolean)
    if (elements.length === 0) {
      toast.info(
        'Tip: adding element symbols (e.g. Fe,O) dramatically improves search accuracy.',
      )
      return
    }
    if (sub.peaks.length === 0) {
      toast.info('Detect or add peaks first.')
      return
    }
    return run(
      'xrd-search',
      () =>
        identifyPhases({
          sessionId: null,
          spectrum,
          peaks: sub.peaks,
          elements,
          tolerance: sub.params.phaseSearch.tolerance,
          topK: sub.params.phaseSearch.topK,
          wavelength: sub.params.refinement.wavelength,
        }),
      (r) => {
        if (!r.success) {
          toast.error(r.error)
          return
        }
        // Mark LLM-picked phases as selected — matches the agent tool so
        // the UI reads the same highlight either way in.
        const predicted = new Set(r.identification.predictedPhases)
        const cands: XrdProCandidate[] = r.candidates.map((c) => ({
          ...c,
          selected: c.material_id ? predicted.has(c.material_id) : false,
        }))
        patchSubState({ candidates: cands, identification: r.identification })
        if (r.identification.predictedPhases.length > 0) {
          toast.success(
            `${cands.length} candidates · LLM picked ${r.identification.predictedPhases.length} @ ${(
              r.identification.confidence * 100
            ).toFixed(0)}%`,
          )
        } else {
          toast.success(`${cands.length} candidates (${r.source})`)
        }
      },
    )
  }

  const handleToggleCandidate = (idx: number) => {
    const next = sub.candidates.slice()
    next[idx] = { ...next[idx], selected: !next[idx].selected }
    patchSubState({ candidates: next })
  }

  const handleToggleCandidateOverlay = (idx: number) => {
    const next = sub.candidates.slice()
    // Only toggle when ref peaks are actually available — otherwise the
    // overlay would register as "on" with nothing to render, which is
    // confusing. The panel button is also disabled in that case but the
    // action handler is the backstop.
    const c = next[idx]
    if (!c?.refPeaks || c.refPeaks.length === 0) return
    next[idx] = { ...c, showOverlay: !c.showOverlay }
    patchSubState({ candidates: next })
  }

  const handleToggleCandidateSimulate = (idx: number) => {
    const next = sub.candidates.slice()
    const c = next[idx]
    if (!c?.refPeaks || c.refPeaks.length === 0) return
    next[idx] = { ...c, showSimulate: !c.showSimulate }
    patchSubState({ candidates: next })
  }

  // Multi-pattern overlay — load secondary spectra alongside the primary
  // data for in-situ / operando / variable-temperature comparison. We
  // route through the existing text-parser pipeline so anything the main
  // spectrum loader handles (CSV / XY / XRDML / …) works as an overlay
  // input too. Binary-only formats are rejected with a toast — would
  // require asking the user to pre-convert or routing through a file-
  // system reader, both out of scope for this round.
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
      const next: XrdPatternOverlay = {
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

  // CIF management for DARA Rietveld. Files are loaded entirely in the
  // renderer (no lattice-cli round-trip) so the inline `content` field
  // feeds the worker directly as `cif_texts`. We cap at ~500 KB per
  // file — BGMN CIFs are usually <20 KB, so anything bigger is probably
  // a mis-dropped log file.
  const CIF_MAX_BYTES = 500 * 1024
  const handleAddCif = async (file: File) => {
    if (file.size > CIF_MAX_BYTES) {
      toast.warn(
        `${file.name} is ${(file.size / 1024).toFixed(0)} KB — CIF cap is ${(CIF_MAX_BYTES / 1024).toFixed(0)} KB.`,
      )
      return
    }
    try {
      const content = await file.text()
      if (!content.trim()) {
        toast.error(`${file.name} is empty`)
        return
      }
      const id = `cif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
      const current = sub.uploadedCifs ?? []
      patchSubState({
        uploadedCifs: [
          ...current,
          {
            id,
            filename: file.name,
            content,
            size: file.size,
            selected: true,
          },
        ],
      })
      toast.success(`Loaded ${file.name} (${(file.size / 1024).toFixed(1)} KB)`)
    } catch (err) {
      toast.error(
        `CIF load failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  const handleToggleCifSelection = (id: string) => {
    const current = sub.uploadedCifs ?? []
    patchSubState({
      uploadedCifs: current.map((c) =>
        c.id === id ? { ...c, selected: !c.selected } : c,
      ),
    })
  }

  const handleRemoveCif = (id: string) => {
    const current = sub.uploadedCifs ?? []
    patchSubState({
      uploadedCifs: current.filter((c) => c.id !== id),
    })
  }

  const handleRestoreParams = (snapshot: unknown) => {
    if (!snapshot || typeof snapshot !== 'object') return
    const record = snapshot as {
      refinement?: Partial<XrdProPayload['params']['refinement']>
      phaseSearch?: Partial<XrdProPayload['params']['phaseSearch']>
      peakDetect?: Partial<XrdProPayload['params']['peakDetect']>
    }
    setParams((p) => ({
      ...p,
      refinement: { ...p.refinement, ...(record.refinement ?? {}) },
      phaseSearch: { ...p.phaseSearch, ...(record.phaseSearch ?? {}) },
      peakDetect: { ...p.peakDetect, ...(record.peakDetect ?? {}) },
    }))
    toast.info('Restored params — click Run when ready')
  }

  const handleRefine = () => {
    const t0 = Date.now()
    const snapshot = { refinement: { ...sub.params.refinement } }
    const materialIds = sub.candidates
      .filter((c: XrdProCandidate) => c.selected && c.material_id)
      .map((c: XrdProCandidate) => c.material_id as string)
    const instrumentProfile =
      sub.params.refinement.instrumentProfile &&
      sub.params.refinement.instrumentProfile.length > 0
        ? sub.params.refinement.instrumentProfile
        : undefined
    const baseRequest = {
      wavelength: sub.params.refinement.wavelength,
      two_theta_min: sub.params.refinement.twoThetaMin,
      two_theta_max: sub.params.refinement.twoThetaMax,
      max_phases: sub.params.refinement.maxPhases,
      material_ids: materialIds,
      instrument_profile: instrumentProfile,
    }

    const command = 'xrd.refine_dara'
    const modeLabel = 'BGMN Rietveld'

    const runner = async () => {
      const currentCifs = sub.uploadedCifs ?? []
      let selected = currentCifs.filter((c) => c.selected)
      let usableSelected = selected.filter(hasUsableCif)

      if (usableSelected.length === 0 && materialIds.length > 0) {
        const fetched = await fetchCifsForMaterialIds(materialIds)
        if (fetched.length > 0) {
          const merged = [
            ...currentCifs.filter(
              (c) => !fetched.some((next) => next.id === c.id),
            ),
            ...fetched,
          ]
          patchSubState({ uploadedCifs: merged })
          selected = merged.filter((c) => c.selected)
          usableSelected = selected.filter(hasUsableCif)
          toast.info(
            `Loaded ${fetched.length} CIF${fetched.length === 1 ? '' : 's'} from the bundled phase database.`,
          )
        }
      }

      if (usableSelected.length === 0) {
        throw new Error(
          materialIds.length > 0
            ? 'The selected phases do not currently have usable CIF files. Try loading CIFs manually, or re-run phase search/refine after the bundled DB is available.'
            : 'Load and select at least one CIF file before running refinement.',
        )
      }

      return localProXrd.refineDara(spectrum, {
        ...baseRequest,
        cif_paths: usableSelected
          .map((c) => c.path)
          .filter((p): p is string => typeof p === 'string' && p.length > 0),
        cif_texts: usableSelected
          .filter(
            (c) => typeof c.content === 'string' && c.content.length > 0,
          )
          .map((c) => ({
            filename: c.filename,
            content: c.content as string,
          })),
      })
    }

    return run(
      'xrd-refine',
      runner,
      (r: XrdRefineResponse) => {
        const durationMs = Date.now() - t0
        if (r.success) {
          const result: XrdProRefineResult = {
            phases: r.data.phases ?? [],
            rwp: r.data.rwp,
            rexp: r.data.rexp,
            gof: r.data.gof,
            converged: r.data.converged,
            quality_flags: r.data.quality_flags,
            x: r.data.x,
            y_obs: r.data.y_obs,
            y_calc: r.data.y_calc,
            y_diff: r.data.y_diff,
          }
          patchSubState({ refineResult: result })
          const rwpText = r.data.rwp != null ? ` Rwp=${r.data.rwp.toFixed(2)}%` : ''
          toast.success(`${modeLabel} done${rwpText}`)
          appendRunRecord(ctx, {
            command,
            paramsSummary: `2θ ${sub.params.refinement.twoThetaMin}–${sub.params.refinement.twoThetaMax}°, ${materialIds.length || 'auto'} phases`,
            resultSummary:
              r.data.rwp != null
                ? `Rwp ${r.data.rwp.toFixed(2)}%, ${result.phases.length} phases`
                : `${result.phases.length} phases`,
            paramsSnapshot: snapshot,
            durationMs,
          })
        } else {
          toast.error(r.error)
          appendRunRecord(ctx, {
            command,
            paramsSummary: `2θ ${sub.params.refinement.twoThetaMin}–${sub.params.refinement.twoThetaMax}°`,
            resultSummary: r.error ?? 'failed',
            paramsSnapshot: snapshot,
            durationMs,
            failed: true,
          })
        }
      },
    )
  }

  const handleExportCif = () => {
    if (!sub.refineResult) {
      toast.warn('Run refinement first')
      return
    }
    const cifBlocks: string[] = []
    for (const ph of sub.refineResult.phases) {
      if (ph.a == null && ph.b == null && ph.c == null) continue
      cifBlocks.push(buildRefinedCif(ph, sub.refineResult.rwp))
    }
    if (cifBlocks.length === 0) {
      toast.warn('No lattice data available for CIF export')
      return
    }
    downloadBlob(cifBlocks.join('\n'), 'refined_phases.cif', 'chemical/x-cif')
    toast.success(`Exported ${cifBlocks.length} phase${cifBlocks.length > 1 ? 's' : ''} to CIF`)
  }

  const handleExportCsv = () => {
    if (sub.peaks.length === 0 && !sub.refineResult) {
      toast.warn('No data to export')
      return
    }
    const sections: string[] = []
    if (sub.peaks.length > 0) {
      sections.push('# Peaks\n' + buildPeaksCsv(sub.peaks))
    }
    if (sub.refineResult) {
      sections.push(buildRefineReportCsv(sub.refineResult))
      if (sub.refineResult.x?.length) {
        sections.push('# Fitted Curves\n' + buildRefineCurveCsv(sub.refineResult))
      }
    }
    downloadBlob(sections.join('\n\n'), 'xrd-export.csv', 'text/csv')
    toast.success('Exported CSV')
  }

  const handleSnapshot = () => {
    // Legacy snapshot expects a concrete XrdProArtifact. On a spectrum-pro
    // artifact we synthesise a matching shape from sub + shared state so
    // the snapshot writer doesn't need to know which kind it's running on.
    const syntheticArtifact: XrdProArtifact = {
      ...(ctx.artifact as XrdProArtifact),
      kind: 'xrd-pro',
      payload: {
        params: sub.params,
        peaks: sub.peaks,
        candidates: sub.candidates,
        refineResult: sub.refineResult,
        uploadedCifs: sub.uploadedCifs ?? [],
        spectrum: ctx.payload.spectrum,
        quality: ctx.payload.quality,
        status: ctx.payload.status,
        lastError: ctx.payload.lastError,
      } as XrdProPayload,
    }
    const id = snapshotXrdWorkbench(ctx.sessionId, syntheticArtifact)
    if (id) toast.success('Saved as XRD Analysis snapshot')
    else toast.warn('Nothing to snapshot — run detection or refinement first')
  }

  const handleApplyPreset = (key: string) => {
    const preset = REFINE_PRESETS[key]
    if (!preset) {
      toast.error(
        `Unknown preset '${key}'. Available: ${Object.keys(REFINE_PRESETS).join(', ')}`,
      )
      return
    }
    setParams((p) => ({
      ...p,
      refinement: {
        ...p.refinement,
        twoThetaMin: preset.twoThetaMin ?? p.refinement.twoThetaMin,
        twoThetaMax: preset.twoThetaMax ?? p.refinement.twoThetaMax,
        maxPhases: preset.maxPhases ?? p.refinement.maxPhases,
      },
    }))
  }

  return {
    busy,
    chartExporter,
    focusedPeakIdx,
    setFocusedPeakIdx,
    setParams,
    handleAssessQuality,
    handleDetectPeaks,
    handleClearPeaks,
    handleManualAddPeak,
    handleRemovePeak,
    handleUpdatePeak,
    handleAddBlankPeak,
    handleSearchDb,
    handleToggleCandidate,
    handleToggleCandidateOverlay,
    handleToggleCandidateSimulate,
    handleAddPatternOverlay,
    handleToggleOverlayVisibility,
    handleRemovePatternOverlay,
    handleClearPatternOverlays,
    handleAddCif,
    handleToggleCifSelection,
    handleRemoveCif,
    handleRefine,
    handleRestoreParams,
    handleExportCif,
    handleExportCsv,
    handleSnapshot,
    handleApplyPreset,
  }
}

// ─── Data tabs ─────────────────────────────────────────────────────

function buildDataTabs(
  ctx: ModuleCtx<XrdSubState>,
  actions: XrdActions,
): ProDataTabDef[] {
  const { sub } = ctx
  return [
    {
      id: 'peaks',
      label: 'Peaks',
      badge: sub.peaks.length || undefined,
      content: (
        <XrdPeaksTab
          peaks={sub.peaks}
          onEdit={actions.handleUpdatePeak}
          onRemove={actions.handleRemovePeak}
          onAdd={actions.handleAddBlankPeak}
          onFocus={actions.setFocusedPeakIdx}
        />
      ),
    },
    {
      id: 'phases',
      label: 'Phases',
      badge: sub.candidates.length || undefined,
      content: (
        <XrdPhasesTab
          candidates={sub.candidates}
          onToggle={actions.handleToggleCandidate}
        />
      ),
    },
    {
      id: 'fit',
      label: 'Fit',
      badge: sub.refineResult?.rwp != null
        ? `Rwp ${sub.refineResult.rwp.toFixed(1)}%`
        : undefined,
      content: <XrdFitTab result={sub.refineResult} />,
    },
    {
      id: 'crystallite',
      label: 'Crystallite',
      content: (
        <XrdCrystalliteTab
          peaks={sub.peaks}
          params={sub.params}
          setParams={actions.setParams}
        />
      ),
    },
    {
      id: 'quality',
      label: 'Quality',
      badge: ctx.payload.quality?.grade ?? undefined,
      content: (
        <XrdQualityTab
          quality={ctx.payload.quality}
          busy={actions.busy === 'assess-quality'}
          onAssess={actions.handleAssessQuality}
        />
      ),
    },
  ]
}

// ─── Defaults + peak normaliser ───────────────────────────────────

function defaultSubState(): XrdSubState {
  // Strip the shared fields from the full-payload factory so the module's
  // default matches what `SpectrumProPayload.xrd` carries.
  const {
    spectrum: _spectrum,
    quality: _quality,
    status: _status,
    lastError: _lastError,
    ...sub
  } = defaultXrdProPayload()
  return sub
}

function peaksFromSub(sub: XrdSubState): NormalisedPeak[] {
  return sub.peaks
}

// ─── Module ───────────────────────────────────────────────────────

export const XrdModule: TechniqueModule<XrdSubState, XrdActions> = {
  technique: 'xrd',
  label: 'XRD',
  defaultSubState,
  useActions: useXrdActions,
  buildOverlays,
  renderMainViz: (ctx, actions) => <MainViz ctx={ctx} actions={actions} />,
  buildDataTabs,
  renderInspector: () => null,
  renderFooter: () => null,
  renderRibbonRight: (ctx, actions) => <XrdToolbar ctx={ctx} actions={actions} />,
  commands: buildXrdCommands,
  peaksFromSub,
}

export default XrdModule
