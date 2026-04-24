import type { ReactNode } from 'react'
import type { Artifact } from '../../types/artifact'
import type { Session } from '../../types/session'
import {
  isPeakFitArtifact,
  isSpectrumArtifact,
} from '../../types/artifact'
import { useRuntimeStore, selectFocusedElement } from '../../stores/runtime-store'
import PlaceholderArtifactCard from './artifacts/PlaceholderArtifactCard'
import UnifiedProWorkbench from './artifacts/UnifiedProWorkbench'
import SpectrumProWindowStub from './artifacts/SpectrumProWindowStub'
import { forwardMention } from './artifact-body/helpers'
import {
  renderBatch,
  renderCompute,
  renderComputePro,
  renderCurveAnalysis,
  renderHypothesis,
  renderJob,
  renderKnowledgeGraph,
  renderLatexDocument,
  renderMaterialComparison,
  renderOptimization,
  renderPaper,
  renderPeakFit,
  renderPlot,
  renderRamanId,
  renderResearchReport,
  renderSimilarityMatrix,
  renderSpectrum,
  renderStructure,
  renderXpsAnalysis,
  renderXrdAnalysis,
  type RenderContext,
} from './artifact-body/kind-renderers'

/**
 * Renders the main body for a focused artifact (shared by ArtifactCanvas and
 * the standalone Pro workbench BrowserWindow).
 *
 * `opts.embed` controls how the five Pro artifact kinds render:
 *  - `'card'` (default, used by the main canvas) — a compact window-stub
 *    (`SpectrumProWindowStub`) telling the user the workbench lives in
 *    its own BrowserWindow, with a button to re-open it. In web mode
 *    (no `window.electronAPI`) the stub auto-falls-back to rendering
 *    the full `UnifiedProWorkbench` inline.
 *  - `'full'` — the full `UnifiedProWorkbench`. Only the satellite window
 *    (`ProWorkbenchStandaloneView`) passes this.
 *
 * Non-Pro kinds ignore `opts` completely.
 */
export function renderArtifactBody(
  artifact: Artifact,
  session: Session,
  opts?: { embed?: 'card' | 'full' },
): ReactNode {
  const embed = opts?.embed ?? 'card'
  const sessionId = session.id
  const store = useRuntimeStore.getState()
  const { upsertArtifact, focusArtifact, patchArtifact, setFocusedElement } =
    store
  const focusedElement = selectFocusedElement(store)
  const onMention = forwardMention(sessionId)

  const ctx: RenderContext = {
    session,
    sessionId,
    focusedElement,
    onMention,
    upsertArtifact,
    patchArtifact,
    focusArtifact,
    setFocusedElement,
  }

  if (isSpectrumArtifact(artifact)) return renderSpectrum(artifact, ctx)
  if (isPeakFitArtifact(artifact)) return renderPeakFit(artifact, ctx)

  switch (artifact.kind) {
    case 'xrd-analysis':
      return renderXrdAnalysis(artifact, ctx)
    case 'xps-analysis':
      return renderXpsAnalysis(artifact, ctx)
    case 'raman-id':
      return renderRamanId(artifact, ctx)
    case 'job':
      return renderJob(artifact)
    case 'compute':
      return renderCompute(artifact, ctx)
    case 'structure':
      return renderStructure(artifact, ctx)
    case 'research-report':
      return renderResearchReport(artifact, ctx)
    case 'batch':
      return renderBatch(artifact, ctx)
    case 'knowledge-graph':
      return renderKnowledgeGraph(artifact, ctx)
    case 'material-comparison':
      return renderMaterialComparison(artifact, ctx)
    case 'paper':
      return renderPaper(artifact, ctx)
    case 'similarity-matrix':
      return renderSimilarityMatrix(artifact)
    case 'optimization':
      return renderOptimization(artifact, ctx)
    case 'hypothesis':
      return renderHypothesis(artifact, ctx)
    case 'xrd-pro':
    case 'xps-pro':
    case 'raman-pro':
    case 'curve-pro':
    case 'spectrum-pro':
      return embed === 'full' ? (
        <UnifiedProWorkbench artifact={artifact} sessionId={sessionId} />
      ) : (
        <SpectrumProWindowStub artifact={artifact} sessionId={sessionId} />
      )
    case 'curve-analysis':
      return renderCurveAnalysis(artifact)
    case 'compute-pro':
      return renderComputePro(artifact)
    case 'latex-document':
      return renderLatexDocument(artifact, ctx)
    case 'plot':
      return renderPlot(artifact, ctx)
    default:
      return <PlaceholderArtifactCard artifact={artifact} />
  }
}
