import { useCallback } from 'react'
import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui'
import ResearchReportArtifactCard from '@/components/canvas/artifacts/ResearchReportArtifactCard'
import { flushRuntimePersist } from '@/stores/runtime-store'
import type { Artifact } from '@/types/artifact'
import type {
  ReportStatus,
  ResearchReportPayload,
} from '@/components/canvas/artifacts/research-report/types'

interface Props {
  artifact: Artifact
  sessionId?: string | null
  sourceLabel?: string | null
}

function hasWorkbenchWindowApi(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.electronAPI?.openWorkbenchWindow === 'function'
  )
}

function statusLabel(status: ReportStatus): string {
  if (status === 'planning') return 'Planning'
  if (status === 'drafting') return 'Drafting'
  return 'Complete'
}

export default function ResearchReportWindowStub({
  artifact,
  sessionId,
  sourceLabel,
}: Props) {
  const payload = artifact.payload as unknown as ResearchReportPayload
  const sections = payload?.sections ?? []
  const citations = payload?.citations ?? []
  const topicLabel =
    payload?.topic?.trim() ||
    artifact.title ||
    'Untitled research'
  const openSupported = hasWorkbenchWindowApi()
  const canOpen =
    openSupported &&
    typeof sessionId === 'string' &&
    sessionId.length > 0

  const handleOpen = useCallback(() => {
    if (!canOpen || !sessionId) return
    flushRuntimePersist()
    void window.electronAPI?.openWorkbenchWindow?.({
      sessionId,
      artifactId: artifact.id,
    })
  }, [artifact.id, canOpen, sessionId])

  if (!openSupported) {
    return <ResearchReportArtifactCard artifact={artifact} />
  }

  return (
    <div className="research-report-window-stub-root">
      <div className="research-report-window-stub-header">
        <span className="research-report-window-stub-badge">
          Research
        </span>
        <span
          className="research-report-window-stub-title"
          title={topicLabel}
        >
          {topicLabel}
        </span>
      </div>

      <div className="research-report-window-stub-meta">
        <span>{statusLabel(payload?.status ?? 'complete')}</span>
        <span aria-hidden>•</span>
        <span>{sections.length} section{sections.length === 1 ? '' : 's'}</span>
        <span aria-hidden>•</span>
        <span>{citations.length} ref{citations.length === 1 ? '' : 's'}</span>
      </div>

      <p className="research-report-window-stub-body">
        Research reports use a dedicated window. The full progress shell,
        outline, body, and references stay there instead of rendering inside
        the workspace.
      </p>

      {sourceLabel ? (
        <div
          className="research-report-window-stub-source"
          title={sourceLabel}
        >
          {sourceLabel}
        </div>
      ) : null}

      <div className="research-report-window-stub-actions">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleOpen}
          disabled={!canOpen}
          leading={<ExternalLink size={13} />}
        >
          Open Window
        </Button>
      </div>

      {!canOpen ? (
        <p className="research-report-window-stub-note">
          This report can only reopen from its live session.
        </p>
      ) : null}
    </div>
  )
}
