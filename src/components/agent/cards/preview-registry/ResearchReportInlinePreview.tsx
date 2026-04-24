import { useCallback, useMemo } from 'react'
import { ExternalLink } from 'lucide-react'
import { flushRuntimePersist, useRuntimeStore } from '../../../../stores/runtime-store'
import type { Artifact } from '../../../../types/artifact'
import type {
  ReportStatus,
  ResearchReportPayload,
} from '../../../canvas/artifacts/research-report/types'

interface Props {
  artifact: Artifact
}

function statusLabel(status: ReportStatus): string {
  if (status === 'planning') return 'Planning'
  if (status === 'drafting') return 'Drafting'
  return 'Complete'
}

function statusClass(status: ReportStatus): string {
  if (status === 'planning') return 'is-planning'
  if (status === 'drafting') return 'is-drafting'
  return 'is-complete'
}

export default function ResearchReportInlinePreview({ artifact }: Props) {
  const payload = artifact.payload as unknown as ResearchReportPayload
  const sections = payload?.sections ?? []
  const citations = payload?.citations ?? []
  const reportStatus: ReportStatus = payload?.status ?? 'complete'
  const draftedCount = useMemo(
    () =>
      sections.filter(
        (s) => s.status === 'done' || s.markdown.trim().length > 0,
      ).length,
    [sections],
  )

  const pct = useMemo(() => {
    if (reportStatus === 'complete') return 100
    if (reportStatus === 'planning') return sections.length > 0 ? 10 : 6
    if (sections.length <= 0) return 12
    return Math.max(12, Math.min(96, (draftedCount / sections.length) * 100))
  }, [reportStatus, draftedCount, sections.length])

  const sessionId = useRuntimeStore((s) => {
    for (const session of Object.values(s.sessions)) {
      if (session.artifacts[artifact.id]) return session.id
    }
    return null
  })

  const canOpenWindow =
    sessionId != null &&
    typeof window !== 'undefined' &&
    typeof window.electronAPI?.openWorkbenchWindow === 'function'

  const handleOpenWindow = useCallback(() => {
    if (!canOpenWindow || !sessionId) return
    flushRuntimePersist()
    void window.electronAPI?.openWorkbenchWindow?.({
      sessionId,
      artifactId: artifact.id,
    })
  }, [artifact.id, canOpenWindow, sessionId])

  const topicLabel =
    payload?.topic?.trim() ||
    'Untitled research'

  return (
    <div className="research-inline-preview">
      <div className="research-inline-preview-head">
        <span
          className={`research-inline-preview-badge ${statusClass(reportStatus)}`}
        >
          {statusLabel(reportStatus)}
        </span>
        <span className="research-inline-preview-topic" title={topicLabel}>
          {topicLabel}
        </span>
      </div>

      <div className="research-inline-preview-progress">
        <div className="research-inline-preview-track">
          <span
            className={`research-inline-preview-fill ${statusClass(reportStatus)}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="research-inline-preview-pct">{Math.round(pct)}%</span>
      </div>

      <div className="research-inline-preview-stats">
        <span>
          {draftedCount}/{sections.length} sections
        </span>
        <span className="research-inline-preview-dot">·</span>
        <span>{citations.length} refs</span>
        <span className="research-inline-preview-dot">·</span>
        <span>Research</span>
      </div>

      {sections.length > 0 && (
        <div className="research-inline-preview-dots">
          {sections.map((sec) => {
            const st = sec.status ?? 'done'
            return (
              <span
                key={sec.id}
                className={`research-inline-preview-section-dot is-${st}`}
                title={sec.heading}
              />
            )
          })}
        </div>
      )}

      {canOpenWindow && (
        <button
          type="button"
          className="research-inline-preview-open"
          onClick={handleOpenWindow}
        >
          <ExternalLink size={12} />
          View Details
        </button>
      )}
    </div>
  )
}
