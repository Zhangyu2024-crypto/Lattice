import PeakFitArtifactCard from '../../canvas/artifacts/PeakFitArtifactCard'
import '../../../styles/artifact-cards.css'
import XrdAnalysisCard from '../../canvas/artifacts/XrdAnalysisCard'
import XpsAnalysisCard from '../../canvas/artifacts/XpsAnalysisCard'
import RamanIdCard from '../../canvas/artifacts/RamanIdCard'
import CurveAnalysisCard from '../../canvas/artifacts/CurveAnalysisCard'
import type {
  CurveAnalysisArtifact,
  CurveAnalysisPayload,
  PeakFitArtifact,
  PeakFitPayload,
  RamanIdArtifact,
  RamanIdPayload,
  XpsAnalysisArtifact,
  XpsAnalysisPayload,
  XrdAnalysisArtifact,
  XrdAnalysisPayload,
} from '../../../types/artifact'
import type { LatticeFileKind } from '../../../lib/workspace/fs/types'
import { useEnvelopeFile } from './useEnvelopeFile'
import UnsupportedFileEditor from './UnsupportedFileEditor'
import EditorLoading from './EditorLoading'
import EditorError from './EditorError'

interface Props {
  relPath: string
  kind: Extract<
    LatticeFileKind,
    'peakfit' | 'xrd' | 'xps' | 'raman' | 'curve'
  >
}

function titleFromPath(relPath: string): string {
  const name = relPath.split('/').pop() ?? relPath
  return name.replace(/\.(peakfit|xrd|xps|raman|curve)\.json$/i, '')
}

export default function AnalysisFileEditor({ relPath, kind }: Props) {
  const { status, envelope, error } = useEnvelopeFile<unknown>(relPath)

  if (status === 'loading') return <EditorLoading relPath={relPath} />
  if (status === 'error' || !envelope) {
    return (
      <EditorError
        relPath={relPath}
        message={error ?? 'Failed to load analysis file'}
      />
    )
  }

  const title = titleFromPath(relPath)
  const commonBase = {
    id: envelope.id || `${kind}_${relPath}`,
    title,
    createdAt: envelope.createdAt,
    updatedAt: envelope.updatedAt,
    sourceFile: relPath,
    parents: [] as string[],
  }

  const wrap = (node: React.ReactNode) => (
    <div style={{ padding: 12, overflow: 'auto', height: '100%' }}>{node}</div>
  )

  if (kind === 'peakfit') {
    const artifact: PeakFitArtifact = {
      ...commonBase,
      kind: 'peak-fit',
      payload: envelope.payload as PeakFitPayload,
    }
    return wrap(<PeakFitArtifactCard peakFit={artifact} spectrum={null} />)
  }

  if (kind === 'xrd') {
    const artifact: XrdAnalysisArtifact = {
      ...commonBase,
      kind: 'xrd-analysis',
      payload: envelope.payload as XrdAnalysisPayload,
    }
    return wrap(<XrdAnalysisCard artifact={artifact} />)
  }

  if (kind === 'xps') {
    const artifact: XpsAnalysisArtifact = {
      ...commonBase,
      kind: 'xps-analysis',
      payload: envelope.payload as XpsAnalysisPayload,
    }
    return wrap(<XpsAnalysisCard artifact={artifact} />)
  }

  if (kind === 'raman') {
    const artifact: RamanIdArtifact = {
      ...commonBase,
      kind: 'raman-id',
      payload: envelope.payload as RamanIdPayload,
    }
    return wrap(<RamanIdCard artifact={artifact} />)
  }

  if (kind === 'curve') {
    const artifact: CurveAnalysisArtifact = {
      ...commonBase,
      kind: 'curve-analysis',
      payload: envelope.payload as CurveAnalysisPayload,
    }
    return wrap(<CurveAnalysisCard artifact={artifact} />)
  }

  return (
    <UnsupportedFileEditor
      relPath={relPath}
      reason={`Unknown analysis kind: ${kind}`}
    />
  )
}
