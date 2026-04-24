// Pure artifact preview card — the Phase-δ ChatArtifactCard surface. No
// tool-call, no approval loop; just an artifact summary with expand +
// optional Open-Workbench.

import { useState } from 'react'
import { Bookmark, ChevronDown, ChevronRight, ExternalLink, FileText, X } from 'lucide-react'
import type { ArtifactId } from '../../../../types/artifact'
import {
  selectActiveSession,
  useRuntimeStore,
} from '../../../../stores/runtime-store'
import { useModalStore } from '../../../../stores/modal-store'
import { useArtifactDbStore } from '../../../../stores/artifact-db-store'
import { toast } from '../../../../stores/toast-store'
import {
  ARTIFACT_KIND_LABEL,
  WORKBENCH_ARTIFACT_KINDS,
  getArtifactPreview,
} from '../preview-registry'
import { ICON_FOR_KIND } from './constants'

export default function ArtifactOnlyPath({
  artifactId,
  labelOverride,
  onDismiss,
  onOpenWorkbench,
}: {
  artifactId: ArtifactId
  labelOverride?: string
  onDismiss?: () => void
  onOpenWorkbench?: (sessionId: string, artifactId: string) => void
}) {
  const session = useRuntimeStore(selectActiveSession)
  const artifact = session?.artifacts[artifactId] ?? null
  const [expanded, setExpanded] = useState(false)

  if (!artifact) {
    return (
      <div className="agent-card agent-card-artifact is-missing is-info">
        <div className="agent-card-header agent-card-header-static">
          <FileText
            size={14}
            className="agent-card-kind-icon"
            aria-hidden
          />
          <span className="agent-card-title">
            {labelOverride ?? 'Artifact no longer in session'}
          </span>
          {onDismiss ? (
            <button
              type="button"
              className="agent-card-dismiss"
              onClick={onDismiss}
              aria-label="Dismiss card"
            >
              <X size={12} aria-hidden />
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  const title = labelOverride ?? artifact.title
  const KindIcon = ICON_FOR_KIND[artifact.kind] ?? FileText
  const preview = getArtifactPreview(artifact)
  const isProKind = WORKBENCH_ARTIFACT_KINDS.has(artifact.kind)
  const kindLabel = ARTIFACT_KIND_LABEL[artifact.kind] ?? artifact.kind

  const handleOpen = session
    ? () => {
        if (isProKind && onOpenWorkbench) {
          onOpenWorkbench(session.id, artifact.id)
        } else {
          useRuntimeStore.getState().focusArtifact(session.id, artifact.id)
          useModalStore.getState().setArtifactOverlay({
            sessionId: session.id,
            artifactId: artifact.id,
          })
        }
      }
    : undefined

  const handleBookmark = session
    ? () => {
        void useArtifactDbStore
          .getState()
          .bookmarkArtifact(artifact, session.id, session.title)
          .then(() => toast.success('Bookmarked'))
          .catch(() => toast.error('Failed to bookmark'))
      }
    : undefined

  return (
    <div className="agent-card agent-card-artifact is-info">
      {/* Header row: icon + title + action icons */}
      <div className="agent-card-header agent-card-header-static">
        <KindIcon size={14} className="agent-card-kind-icon" aria-hidden />
        <div className="agent-card-title-group">
          <span className="agent-card-title">{title}</span>
          <span className="agent-card-kind">
            {kindLabel}
            {preview.oneLiner ? (
              <>
                <span className="agent-card-dot"> · </span>
                {preview.oneLiner}
              </>
            ) : null}
          </span>
        </div>
        {/* Right-aligned icon buttons */}
        <div className="agent-card-header-actions">
          {handleBookmark ? (
            <button
              type="button"
              className="agent-card-icon-btn"
              onClick={handleBookmark}
              title="Bookmark"
            >
              <Bookmark size={13} aria-hidden />
            </button>
          ) : null}
          {handleOpen ? (
            <button
              type="button"
              className="agent-card-icon-btn is-primary"
              onClick={handleOpen}
              title={isProKind ? 'Open workbench' : 'Open'}
            >
              <ExternalLink size={13} aria-hidden />
            </button>
          ) : null}
          {onDismiss ? (
            <button
              type="button"
              className="agent-card-icon-btn"
              onClick={onDismiss}
              title="Dismiss"
            >
              <X size={13} aria-hidden />
            </button>
          ) : null}
        </div>
      </div>

      {/* Body: meta grid + previews */}
      {(preview.meta && preview.meta.length > 0) || preview.compact || (expanded && preview.expanded) ? (
        <div className="agent-card-body">
          {preview.meta && preview.meta.length > 0 ? (
            <div className="agent-card-meta-grid">
              {preview.meta.map((item) => (
                <div key={item.label} className="agent-card-meta-cell">
                  <span className="agent-card-meta-label">{item.label}</span>
                  <span className="agent-card-meta-value">{item.value}</span>
                </div>
              ))}
            </div>
          ) : null}
          {preview.compact ? (
            <div className="agent-card-preview-compact">{preview.compact}</div>
          ) : null}
          {expanded && preview.expanded ? (
            <div className="agent-card-preview-expanded">{preview.expanded}</div>
          ) : null}
        </div>
      ) : null}

      {/* Footer: expand only (if there's expandable content) */}
      {preview.expanded ? (
        <div className="agent-card-actions">
          <button
            type="button"
            className="agent-card-btn"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {expanded ? (
              <ChevronDown size={11} aria-hidden />
            ) : (
              <ChevronRight size={11} aria-hidden />
            )}
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
