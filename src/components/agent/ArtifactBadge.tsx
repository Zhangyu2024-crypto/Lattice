import { useCallback, useMemo } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { getArtifactDisplayTitle } from '../../lib/artifact-titles'
import {
  selectActiveSession,
  useRuntimeStore,
} from '../../stores/runtime-store'
import type { Artifact, ArtifactKind } from '../../types/artifact'

interface Props {
  artifactId: string
}

export default function ArtifactBadge({ artifactId }: Props) {
  const session = useRuntimeStore(selectActiveSession)
  const focusArtifact = useRuntimeStore((s) => s.focusArtifact)
  const appendArtifactCardMessage = useRuntimeStore(
    (s) => s.appendArtifactCardMessage,
  )

  const artifact = useMemo<Artifact | null>(() => {
    if (!session) return null
    return session.artifacts[artifactId] ?? null
  }, [session, artifactId])
  const displayTitle = artifact ? getArtifactDisplayTitle(artifact) : ''
  const targetLabel = artifact ? artifactTargetLabel(artifact, displayTitle) : ''
  const openLabel = artifact ? `Open ${kindLabel(artifact.kind)}` : 'Open artifact'

  const handleClick = useCallback(() => {
    if (!session || !artifact) return
    const sid = session.id
    focusArtifact(sid, artifact.id)

    const current = useRuntimeStore.getState().sessions[sid]
    if (!current) return
    const tail = current.transcript.slice(-8)
    const alreadyShown = tail.some(
      (m) => m.artifactCardRef?.artifactId === artifact.id,
    )
    if (!alreadyShown) {
      appendArtifactCardMessage(sid, artifact.id)
    }
  }, [session, artifact, focusArtifact, appendArtifactCardMessage])

  if (!session) return null

  if (!artifact) {
    return (
      <span className="artifact-badge artifact-badge-missing">
        unknown artifact
      </span>
    )
  }

  return (
    <button
      className="artifact-badge artifact-badge-btn"
      onClick={handleClick}
      title={targetLabel ? `${openLabel} for ${targetLabel}` : openLabel}
    >
      <span className="artifact-badge-action">Open</span>
      <span className="artifact-badge-kind">{kindLabel(artifact.kind)}</span>
      {targetLabel ? (
        <span className="artifact-badge-title">{targetLabel}</span>
      ) : null}
      <ArrowUpRight size={10} />
    </button>
  )
}

const KIND_BADGE_LABEL: Record<ArtifactKind, string> = {
  spectrum: 'Spec',
  'peak-fit': 'Peaks',
  'xrd-analysis': 'XRD',
  'xps-analysis': 'XPS',
  'raman-id': 'Raman',
  structure: 'Struct',
  compute: 'Code',
  job: 'Job',
  'research-report': 'Report',
  batch: 'Batch',
  'material-comparison': 'Compare',
  paper: 'Paper',
  'similarity-matrix': 'Sim',
  optimization: 'Optim',
  hypothesis: 'Hypo',
  'xrd-pro': 'XRD Lab',
  'xps-pro': 'XPS Lab',
  'raman-pro': 'Raman Lab',
  'curve-pro': 'Curve Lab',
  'curve-analysis': 'Curve',
  'spectrum-pro': 'Spec Lab',
  'compute-pro': 'Code Lab',
  'latex-document': 'LaTeX',
  plot: 'Plot',
}

function kindLabel(kind: ArtifactKind): string {
  return KIND_BADGE_LABEL[kind] ?? 'Art'
}

function artifactTargetLabel(artifact: Artifact, displayTitle: string): string {
  const trimmed = displayTitle.trim()
  if (!trimmed) return ''
  if (isNumericSpectrumTitle(artifact.kind, trimmed)) return `sample ${trimmed}`
  return trimmed
}

function isNumericSpectrumTitle(kind: ArtifactKind, title: string): boolean {
  if (!/^\d[\d._-]*$/.test(title)) return false
  return (
    kind === 'spectrum' ||
    kind === 'xrd-analysis' ||
    kind === 'xps-analysis' ||
    kind === 'xrd-pro' ||
    kind === 'xps-pro' ||
    kind === 'raman-pro' ||
    kind === 'curve-pro' ||
    kind === 'spectrum-pro'
  )
}
