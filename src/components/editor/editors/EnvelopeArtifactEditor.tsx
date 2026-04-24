import type { Artifact } from '../../../types/artifact'
import type { LatticeFileKind } from '../../../lib/workspace/fs/types'
import { useEnvelopeFile } from './useEnvelopeFile'
import EditorLoading from './EditorLoading'
import EditorError from './EditorError'
import UnsupportedFileEditor from './UnsupportedFileEditor'

import JobMonitorCard from '../../canvas/artifacts/JobMonitorCard'
import ResearchReportArtifactCard from '../../canvas/artifacts/ResearchReportArtifactCard'
import ResearchReportWindowStub from '../../canvas/artifacts/ResearchReportWindowStub'
import HypothesisArtifactCard from '../../canvas/artifacts/HypothesisArtifactCard'
import BatchWorkflowCard from '../../canvas/artifacts/BatchWorkflowCard'
import MaterialComparisonCard from '../../canvas/artifacts/MaterialComparisonCard'
import PaperArtifactCard from '../../canvas/artifacts/PaperArtifactCard'
import SimilarityMatrixCard from '../../canvas/artifacts/SimilarityMatrixCard'
import OptimizationArtifactCard from '../../canvas/artifacts/OptimizationArtifactCard'
import StructureArtifactCard from '../../canvas/artifacts/StructureArtifactCard'
import ComputeArtifactCard from '../../canvas/artifacts/ComputeArtifactCard'
import CurveAnalysisCard from '../../canvas/artifacts/CurveAnalysisCard'
import LatexDocumentCard from '../../canvas/artifacts/latex/LatexDocumentCard'
import UnifiedProWorkbench from '../../canvas/artifacts/UnifiedProWorkbench'
import ComputeProLauncherCard from '../../canvas/artifacts/ComputeProLauncherCard'

interface Props {
  relPath: string
  kind: LatticeFileKind
}

const FILE_KIND_TO_ARTIFACT_KIND: Record<string, string> = {
  job: 'job',
  'research-report': 'research-report',
  hypothesis: 'hypothesis',
  paper: 'paper',
  'material-comp': 'material-comparison',
  batch: 'batch',
  optimization: 'optimization',
  similarity: 'similarity-matrix',
  'structure-meta': 'structure',
  'latex-document': 'latex-document',
}

function titleFromPath(relPath: string): string {
  const name = relPath.split('/').pop() ?? relPath
  const idx = name.indexOf('.')
  return idx > 0 ? name.slice(0, idx) : name
}

export default function EnvelopeArtifactEditor({ relPath, kind }: Props) {
  const { status, envelope, error } = useEnvelopeFile<unknown>(relPath)

  if (status === 'loading') return <EditorLoading relPath={relPath} />
  if (status === 'error' || !envelope) {
    return (
      <EditorError
        relPath={relPath}
        message={error ?? 'Failed to load file'}
      />
    )
  }

  const payload = envelope.payload as Record<string, unknown> | null
  const artifactKind =
    kind === 'workbench'
      ? (payload as { kind?: string } | null)?.kind ?? 'workbench'
      : FILE_KIND_TO_ARTIFACT_KIND[kind] ?? envelope.kind

  const artifact: Artifact = {
    id: envelope.id || `${kind}_${relPath}`,
    kind: artifactKind as Artifact['kind'],
    title: titleFromPath(relPath),
    createdAt: envelope.createdAt,
    updatedAt: envelope.updatedAt,
    sourceFile: relPath,
    parents: [],
    payload: payload as never,
  }

  if (artifact.kind === 'research-report') {
    const meta = envelope.meta as Record<string, unknown> | undefined
    const sessionId =
      typeof meta?.sessionId === 'string' ? meta.sessionId : null
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <ResearchReportWindowStub
          artifact={artifact}
          sessionId={sessionId}
          sourceLabel={relPath}
        />
      </div>
    )
  }

  const card = renderCard(artifact)
  if (!card) {
    return (
      <UnsupportedFileEditor
        relPath={relPath}
        reason={`Unrecognized artifact kind: ${artifactKind}`}
      />
    )
  }

  return (
    <div style={{ overflow: 'auto', height: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 14px',
          borderBottom: '1px solid var(--color-border)',
          fontSize: "var(--text-xs)",
          color: 'var(--color-text-muted)',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            padding: '2px 7px',
            borderRadius: 3,
            background: 'var(--bg-hover, #2a2a2a)',
            fontSize: "var(--text-xxs)",
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          Preview
        </span>
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={relPath}
        >
          {relPath}
        </span>
      </div>
      <div style={{ padding: 12 }}>{card}</div>
    </div>
  )
}

const PREVIEW_SESSION = ''

function renderCard(artifact: Artifact) {
  switch (artifact.kind) {
    case 'job':
      return <JobMonitorCard artifact={artifact} />
    case 'research-report':
      return <ResearchReportArtifactCard artifact={artifact} />
    case 'hypothesis':
      return <HypothesisArtifactCard artifact={artifact} />
    case 'paper':
      return <PaperArtifactCard artifact={artifact} />
    case 'material-comparison':
      return <MaterialComparisonCard artifact={artifact} />
    case 'batch':
      return <BatchWorkflowCard artifact={artifact} sessionId={PREVIEW_SESSION} />
    case 'optimization':
      return <OptimizationArtifactCard artifact={artifact} />
    case 'similarity-matrix':
      return <SimilarityMatrixCard artifact={artifact} />
    case 'structure':
      return <StructureArtifactCard artifact={artifact} />
    case 'compute':
      return <ComputeArtifactCard artifact={artifact} />
    case 'curve-analysis':
      return <CurveAnalysisCard artifact={artifact} />
    case 'latex-document':
      return <LatexDocumentCard artifact={artifact} sessionId={PREVIEW_SESSION} />
    case 'xrd-pro':
    case 'xps-pro':
    case 'raman-pro':
    case 'curve-pro':
    case 'spectrum-pro':
      return <UnifiedProWorkbench artifact={artifact} sessionId={PREVIEW_SESSION} />
    case 'compute-pro':
      return <ComputeProLauncherCard artifact={artifact} />
    default:
      return null
  }
}
