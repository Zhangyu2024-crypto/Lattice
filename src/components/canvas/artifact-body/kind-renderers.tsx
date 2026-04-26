import type { ReactNode } from 'react'
import type {
  Artifact,
  PeakFitArtifact,
  SpectrumArtifact,
  XrdAnalysisArtifact,
  XpsAnalysisArtifact,
  RamanIdArtifact,
  JobArtifact,
  ComputeArtifact,
  ComputeExperimentArtifact,
  StructureArtifact,
  ResearchReportArtifact,
  BatchArtifact,
  MaterialComparisonArtifact,
  PaperArtifact,
  SimilarityMatrixArtifact,
  OptimizationArtifact,
  HypothesisArtifact,
  CurveAnalysisArtifact,
  ComputeProArtifact,
  LatexDocumentArtifact,
  PlotArtifact,
  XpsProPeakDef,
} from '../../../types/artifact'
import type { FocusedElementTarget, Session } from '../../../types/session'
import {
  getActiveTranscript,
  useRuntimeStore,
} from '../../../stores/runtime-store'
import { submitAgentPrompt } from '../../../lib/agent-submit'
import {
  createProWorkbench,
  latestSpectrumFromSession,
  spectrumPayloadToProSpectrum,
} from '../../../lib/pro-workbench'
import { xrdAnalysisToInitialState } from '../../../lib/pro-workbench/xrd-analysis-state'
import { cancelBatch, runBatch } from '../../../lib/batch-runner'
import { mockBatchExecutor } from '../../../lib/batch-executors/mock'
import { cancelCompute, runCompute } from '../../../lib/compute-run'
import { cancelComputeExperiment, runComputeExperiment } from '../../../lib/compute-experiment-runner'
import { toast } from '../../../stores/toast-store'
import SpectrumArtifactCard from '../artifacts/SpectrumArtifactCard'
import PeakFitArtifactCard from '../artifacts/PeakFitArtifactCard'
import XrdAnalysisCard from '../artifacts/XrdAnalysisCard'
import XpsAnalysisCard from '../artifacts/XpsAnalysisCard'
import RamanIdCard from '../artifacts/RamanIdCard'
import JobMonitorCard from '../artifacts/JobMonitorCard'
import ComputeArtifactCard from '../artifacts/ComputeArtifactCard'
import ComputeExperimentCard from '../artifacts/ComputeExperimentCard'
import StructureArtifactCard from '../artifacts/StructureArtifactCard'
import PlotArtifactCard from '../artifacts/PlotArtifactCard'
import ResearchReportWindowStub from '../artifacts/ResearchReportWindowStub'
import BatchWorkflowCard from '../artifacts/BatchWorkflowCard'
import MaterialComparisonCard from '../artifacts/MaterialComparisonCard'
import PaperArtifactCard from '../artifacts/PaperArtifactCard'
import SimilarityMatrixCard from '../artifacts/SimilarityMatrixCard'
import OptimizationArtifactCard from '../artifacts/OptimizationArtifactCard'
import HypothesisArtifactCard from '../artifacts/HypothesisArtifactCard'
import CurveAnalysisCard from '../artifacts/CurveAnalysisCard'
import ComputeProLauncherCard from '../artifacts/ComputeProLauncherCard'
import LatexDocumentCard from '../artifacts/latex/LatexDocumentCard'
import { findLatestByKind, resolveBatchLinkedArtifact } from './helpers'
import type { MentionAddRequest } from '../../../lib/composer-bus'

/**
 * Bundled closures + session snapshot that each per-kind renderer needs. This
 * mirrors the inline state captured by `renderArtifactBody` before the split,
 * so extracted renderers remain behaviorally identical to the original switch.
 */
export interface RenderContext {
  session: Session
  sessionId: string
  focusedElement: FocusedElementTarget | null
  onMention: (req: MentionAddRequest) => void
  upsertArtifact: ReturnType<typeof useRuntimeStore.getState>['upsertArtifact']
  patchArtifact: ReturnType<typeof useRuntimeStore.getState>['patchArtifact']
  focusArtifact: ReturnType<typeof useRuntimeStore.getState>['focusArtifact']
  setFocusedElement: ReturnType<
    typeof useRuntimeStore.getState
  >['setFocusedElement']
}

export function renderSpectrum(
  artifact: SpectrumArtifact,
  ctx: RenderContext,
): ReactNode {
  const latestPeakFit = findLatestByKind<PeakFitArtifact>(
    ctx.session,
    'peak-fit',
  )
  return (
    <SpectrumArtifactCard
      spectrum={artifact}
      overlayPeakFit={latestPeakFit ?? null}
    />
  )
}

export function renderPeakFit(
  artifact: PeakFitArtifact,
  ctx: RenderContext,
): ReactNode {
  const { session, sessionId, focusedElement, onMention, setFocusedElement } =
    ctx
  const spectrum = artifact.payload.spectrumId
    ? (session.artifacts[artifact.payload.spectrumId] as
        | SpectrumArtifact
        | undefined)
    : findLatestByKind<SpectrumArtifact>(session, 'spectrum')
  const peakFitFocus =
    focusedElement?.artifactId === artifact.id &&
    focusedElement.elementKind === 'peak'
      ? focusedElement.elementId
      : null
  return (
    <PeakFitArtifactCard
      peakFit={artifact}
      spectrum={spectrum ?? null}
      focusedPeakId={peakFitFocus}
      onFocusPeak={(target) => setFocusedElement(sessionId, target)}
      onMentionPeak={onMention}
      onSubmitRefit={async (prompt) => {
        await submitAgentPrompt(prompt, {
          sessionId,
          transcript: getActiveTranscript(session),
        })
      }}
    />
  )
}

export function renderXrdAnalysis(
  artifact: XrdAnalysisArtifact,
  ctx: RenderContext,
): ReactNode {
  const { sessionId, focusedElement, onMention, setFocusedElement } = ctx
  const xrdFocus =
    focusedElement?.artifactId === artifact.id &&
    focusedElement.elementKind === 'phase'
      ? focusedElement.elementId
      : null
  return (
    <XrdAnalysisCard
      artifact={artifact}
      focusedPhaseId={xrdFocus}
      onFocusPhase={(target) => setFocusedElement(sessionId, target)}
      onMentionPhase={onMention}
      onOpenInProWorkbench={() => {
        const exp = (artifact as XrdAnalysisArtifact).payload
          .experimentalPattern
        const spec = spectrumPayloadToProSpectrum({
          x: exp.x,
          y: exp.y,
          xLabel: exp.xLabel,
          yLabel: exp.yLabel,
          spectrumType: 'xrd',
          processingChain: [],
        }, artifact.sourceFile ?? null)
        createProWorkbench({
          sessionId,
          kind: 'xrd-pro',
          spectrum: spec,
          sourceArtifactId: artifact.id,
          initialXrdState: xrdAnalysisToInitialState(artifact.payload),
        })
        toast.info('Opened in XRD Lab')
      }}
    />
  )
}

export function renderXpsAnalysis(
  artifact: XpsAnalysisArtifact,
  ctx: RenderContext,
): ReactNode {
  const { sessionId, onMention } = ctx
  return (
    <XpsAnalysisCard
      artifact={artifact}
      onMentionQuantRow={onMention}
      onOpenInProWorkbench={({ experimentalPattern, peaks, bindingRange }) => {
        const spec = experimentalPattern
          ? spectrumPayloadToProSpectrum({
              x: experimentalPattern.x,
              y: experimentalPattern.y,
              xLabel: 'Binding Energy (eV)',
              yLabel: 'Intensity',
              spectrumType: 'xps',
              processingChain: [],
            }, artifact.sourceFile ?? null)
          : latestSpectrumFromSession(sessionId)
        // Convert snapshot peaks (area + fwhm) into XpsProPeakDef's
        // `intensity` via the pseudo-Voigt height formula — same logic as
        // the old inline implementation.
        const initialPeaks: XpsProPeakDef[] = peaks.map((p, i) => ({
          id: `refit_${i}_${Date.now().toString(36)}`,
          label: p.label || `Peak_${i + 1}`,
          type: 'single',
          position: p.binding,
          intensity:
            p.fwhm > 0 ? (p.area * 4) / (Math.PI * p.fwhm) : p.area || 1000,
          fwhm: p.fwhm > 0 ? p.fwhm : 1.0,
        }))
        createProWorkbench({
          sessionId,
          kind: 'xps-pro',
          spectrum: spec,
          sourceArtifactId: artifact.id,
          initialPeaks: initialPeaks.length > 0 ? initialPeaks : undefined,
          initialEnergyWindow: {
            min: Math.min(bindingRange[0], bindingRange[1]),
            max: Math.max(bindingRange[0], bindingRange[1]),
          },
        })
        toast.info(
          initialPeaks.length > 0
            ? `Opened in XPS Lab — ${initialPeaks.length} peaks pre-loaded`
            : 'Opened in XPS Lab',
        )
      }}
    />
  )
}

export function renderRamanId(
  artifact: RamanIdArtifact,
  ctx: RenderContext,
): ReactNode {
  const { sessionId, onMention } = ctx
  return (
    <RamanIdCard
      artifact={artifact}
      onMentionMatch={onMention}
      onOpenInProWorkbench={({ experimentalSpectrum }) => {
        const spec = spectrumPayloadToProSpectrum({
          x: experimentalSpectrum.x,
          y: experimentalSpectrum.y,
          xLabel: experimentalSpectrum.xLabel,
          yLabel: experimentalSpectrum.yLabel,
          spectrumType: 'raman',
          processingChain: [],
        }, artifact.sourceFile ?? null)
        createProWorkbench({
          sessionId,
          kind: 'raman-pro',
          spectrum: spec,
          sourceArtifactId: artifact.id,
        })
        toast.info('Opened in Raman Lab')
      }}
    />
  )
}

export function renderJob(artifact: JobArtifact): ReactNode {
  return <JobMonitorCard artifact={artifact} />
}

export function renderCompute(
  artifact: ComputeArtifact,
  ctx: RenderContext,
): ReactNode {
  const { sessionId, patchArtifact } = ctx
  return (
    <ComputeArtifactCard
      artifact={artifact}
      onPatchPayload={(nextPayload) => {
        patchArtifact(sessionId, artifact.id, { payload: nextPayload } as never)
      }}
      onRun={async ({ code }) => {
        const result = await runCompute({
          sessionId,
          artifactId: artifact.id,
          code,
        })
        if (!result.success && result.error) {
          toast.error(result.error)
        }
      }}
      onStop={async () => {
        const ok = await cancelCompute(artifact.id)
        if (!ok) toast.warn('No active run to cancel')
      }}
    />
  )
}


export function renderComputeExperiment(
  artifact: ComputeExperimentArtifact,
  ctx: RenderContext,
): ReactNode {
  const { sessionId } = ctx
  return (
    <ComputeExperimentCard
      artifact={artifact}
      onRun={async () => {
        try {
          await runComputeExperiment({ sessionId, artifactId: artifact.id, mode: 'pending' })
          toast.success('Compute experiment finished')
        } catch (err) {
          toast.error(err instanceof Error ? err.message : String(err))
        }
      }}
      onStop={async () => {
        const stopped = await cancelComputeExperiment(sessionId, artifact.id)
        toast.info(stopped ? 'Stop requested' : 'No active experiment run')
      }}
      onRerunFailed={async () => {
        try {
          await runComputeExperiment({ sessionId, artifactId: artifact.id, mode: 'failed' })
          toast.success('Failed points rerun finished')
        } catch (err) {
          toast.error(err instanceof Error ? err.message : String(err))
        }
      }}
    />
  )
}

export function renderStructure(
  artifact: StructureArtifact,
  ctx: RenderContext,
): ReactNode {
  const { sessionId, patchArtifact } = ctx
  return (
    <StructureArtifactCard
      artifact={artifact}
      onPatchPayload={(nextPayload) => {
        patchArtifact(sessionId, artifact.id, { payload: nextPayload } as never)
      }}
    />
  )
}

export function renderResearchReport(
  artifact: ResearchReportArtifact,
  ctx: RenderContext,
): ReactNode {
  return (
    <ResearchReportWindowStub
      artifact={artifact}
      sessionId={ctx.sessionId}
    />
  )
}

export function renderBatch(
  artifact: BatchArtifact,
  ctx: RenderContext,
): ReactNode {
  const { sessionId, focusArtifact } = ctx
  return (
    <BatchWorkflowCard
      artifact={artifact}
      sessionId={sessionId}
      onStart={({ onlyPending }) => {
        runBatch({
          sessionId,
          artifactId: artifact.id,
          executor: mockBatchExecutor(),
          onlyPending,
        })
        toast.info(onlyPending ? 'Resuming remaining files…' : 'Batch started')
      }}
      onCancel={() => {
        const cancelled = cancelBatch(artifact.id, 'User cancelled')
        toast.info(cancelled ? 'Cancel requested' : 'No active batch to cancel')
      }}
      onOpenLinkedFile={(file) => {
        const current = useRuntimeStore.getState().sessions[sessionId]
        if (!current) return
        const linkedId = resolveBatchLinkedArtifact(current, file)
        if (linkedId) {
          focusArtifact(sessionId, linkedId)
          toast.success(
            `Focused ${current.artifacts[linkedId]?.title ?? linkedId}`,
          )
          return
        }
        toast.info(`No linked artifact found for ${file.relPath}`)
      }}
    />
  )
}

export function renderMaterialComparison(
  artifact: MaterialComparisonArtifact,
  ctx: RenderContext,
): ReactNode {
  const { sessionId, upsertArtifact, focusArtifact } = ctx
  return (
    <MaterialComparisonCard
      artifact={artifact}
      onOpenDerivedArtifact={(next) => {
        upsertArtifact(sessionId, next)
        focusArtifact(sessionId, next.id)
        toast.success(`Opened material brief for ${next.title}`)
      }}
    />
  )
}

export function renderPaper(
  artifact: PaperArtifact,
  ctx: RenderContext,
): ReactNode {
  const { sessionId, patchArtifact } = ctx
  return (
    <PaperArtifactCard
      artifact={artifact}
      onPatchMetadata={({ title, payload }) => {
        patchArtifact(sessionId, artifact.id, { title, payload } as never)
      }}
    />
  )
}

export function renderSimilarityMatrix(
  artifact: SimilarityMatrixArtifact,
): ReactNode {
  return <SimilarityMatrixCard artifact={artifact} />
}

export function renderOptimization(
  artifact: OptimizationArtifact,
  ctx: RenderContext,
): ReactNode {
  const { sessionId, patchArtifact } = ctx
  return (
    <OptimizationArtifactCard
      artifact={artifact}
      onPatchPayload={(nextPayload) => {
        patchArtifact(sessionId, artifact.id, { payload: nextPayload } as never)
      }}
    />
  )
}

export function renderHypothesis(
  artifact: HypothesisArtifact,
  ctx: RenderContext,
): ReactNode {
  const { sessionId, patchArtifact, focusArtifact } = ctx
  return (
    <HypothesisArtifactCard
      artifact={artifact}
      onPatchPayload={(nextPayload) => {
        patchArtifact(sessionId, artifact.id, { payload: nextPayload } as never)
      }}
      onFocusEvidenceArtifact={(artifactId) => {
        const current = useRuntimeStore.getState().sessions[sessionId]
        const target = current?.artifacts[artifactId]
        if (!target) {
          toast.warn(`Artifact ${artifactId} is not present in this session`)
          return
        }
        focusArtifact(sessionId, artifactId)
        toast.success(`Focused ${target.title}`)
      }}
    />
  )
}

export function renderCurveAnalysis(
  artifact: CurveAnalysisArtifact,
): ReactNode {
  return <CurveAnalysisCard artifact={artifact} />
}

export function renderComputePro(artifact: ComputeProArtifact): ReactNode {
  return <ComputeProLauncherCard artifact={artifact} />
}

export function renderLatexDocument(
  artifact: LatexDocumentArtifact,
  ctx: RenderContext,
): ReactNode {
  const { sessionId } = ctx
  return <LatexDocumentCard artifact={artifact} sessionId={sessionId} />
}

export function renderPlot(
  artifact: PlotArtifact,
  ctx: RenderContext,
): ReactNode {
  const { sessionId, patchArtifact } = ctx
  return (
    <PlotArtifactCard
      artifact={artifact}
      onPatchPayload={(nextPayload) => {
        patchArtifact(sessionId, artifact.id, {
          payload: nextPayload,
        } as never)
      }}
    />
  )
}
