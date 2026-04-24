import { useCallback, useMemo, useRef } from 'react'
import {
  AlertTriangle,
  ExternalLink,
  X,
} from 'lucide-react'
import ResearchReportArtifactCard from '@/components/canvas/artifacts/ResearchReportArtifactCard'
import ResearchExportButton from '@/components/research/ResearchExportButton'
import { SectionStatusDot } from '@/components/canvas/artifacts/research-report/bits'
import type {
  ReportStatus,
  ResearchReportPayload,
} from '@/components/canvas/artifacts/research-report/types'
import { Button } from '@/components/ui'
import { flushRuntimePersist, useRuntimeStore } from '@/stores/runtime-store'
import type { Artifact } from '@/types/artifact'

interface Props {
  artifact: Artifact
  presentation?: 'workspace' | 'standalone'
  sessionId?: string | null
  sourcePath?: string | null
  onCloseWindow?: () => void
}

function trimHeading(heading: string): string {
  return heading.replace(/^\d+\.\s*/, '').trim()
}

function formatUpdated(ms: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(ms)
}

function statusCopy(
  status: ReportStatus,
  currentHeading: string | null,
  draftedCount: number,
  totalSections: number,
): string {
  if (status === 'planning') {
    return 'Building the outline and seeding the report scaffold.'
  }
  if (status === 'drafting') {
    if (currentHeading) {
      return `Drafting ${trimHeading(currentHeading)} and streaming updates into the report.`
    }
    return `Drafting in progress across ${draftedCount}/${totalSections} sections.`
  }
  return 'Draft complete. Review the narrative, inspect references, or export the report.'
}

function progressPercent(
  status: ReportStatus,
  draftedCount: number,
  totalSections: number,
  hasCurrentSection: boolean,
): number {
  if (status === 'complete') return 100
  if (status === 'planning') return totalSections > 0 ? 10 : 6
  if (totalSections <= 0) return 12
  const liveCount = draftedCount + (hasCurrentSection ? 0.55 : 0)
  return Math.max(12, Math.min(96, (liveCount / totalSections) * 100))
}

function statusLabel(status: ReportStatus): string {
  if (status === 'planning') return 'Planning'
  if (status === 'drafting') return 'Drafting'
  return 'Complete'
}

export default function ResearchProgressShell({
  artifact,
  presentation = 'workspace',
  sessionId,
  sourcePath,
  onCloseWindow,
}: Props) {
  const payload = artifact.payload as unknown as ResearchReportPayload
  const sections = payload?.sections ?? []
  const citations = payload?.citations ?? []
  const reportStatus: ReportStatus = payload?.status ?? 'complete'
  const bodyScrollRef = useRef<HTMLDivElement | null>(null)
  const draftedCount = useMemo(
    () =>
      sections.filter(
        (section) =>
          section.status === 'done' || section.markdown.trim().length > 0,
      ).length,
    [sections],
  )
  const currentSection = useMemo(() => {
    if (!payload?.currentSectionId) return null
    return sections.find((section) => section.id === payload.currentSectionId) ?? null
  }, [payload?.currentSectionId, sections])
  const hasUnverifiedCitations = useMemo(
    () => citations.some((citation) => citation.unverified === true),
    [citations],
  )
  const hasLiveArtifact = useRuntimeStore((state) =>
    sessionId ? Boolean(state.sessions[sessionId]?.artifacts[artifact.id]) : false,
  )
  const topicLabel =
    payload?.topic?.trim() || 'Untitled research'
  const modeLabel = 'Research'
  const styleLabel =
    payload.style === 'comprehensive' ? 'Comprehensive' : 'Concise'
  const progressLabel = statusLabel(reportStatus)
  const pct = progressPercent(
    reportStatus,
    draftedCount,
    sections.length,
    currentSection != null,
  )

  const canOpenWindow =
    presentation === 'workspace' &&
    typeof sessionId === 'string' &&
    sessionId.length > 0 &&
    hasLiveArtifact &&
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

  if (!payload) {
    return <ResearchReportArtifactCard artifact={artifact} />
  }

  return (
    <div
      className={`research-progress-shell is-${presentation} is-${reportStatus}`}
    >
      <div className="research-progress-shell-frame">
        <div className="research-progress-shell-head">
          <div className="research-progress-shell-head-copy">
            <div className="research-progress-shell-pathline">
              <span className="research-progress-shell-kicker">
                {modeLabel.toUpperCase()}
              </span>
              <span className="research-progress-shell-path-sep" aria-hidden>
                •
              </span>
              <span className="research-progress-shell-pathline-status">
                {progressLabel}
              </span>
              {sourcePath ? (
                <>
                  <span className="research-progress-shell-path-sep" aria-hidden>
                    /
                  </span>
                  <span
                    className="research-progress-shell-source"
                    title={sourcePath}
                  >
                    {sourcePath}
                  </span>
                </>
              ) : null}
            </div>
            <h1 className="research-progress-shell-title">{topicLabel}</h1>
          </div>

          <div className="research-progress-shell-actions">
            <ResearchExportButton
              payload={payload}
              bodyScrollRef={bodyScrollRef}
            />
            {canOpenWindow ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleOpenWindow}
                leading={<ExternalLink size={13} />}
              >
                Open Window
              </Button>
            ) : null}
            {onCloseWindow ? (
              <button
                type="button"
                className="research-progress-shell-close"
                onClick={onCloseWindow}
                aria-label="Close window"
                title="Close window"
              >
                <X size={15} />
              </button>
            ) : null}
          </div>
        </div>

        <div className="research-progress-shell-meta-strip">
          <div className="research-progress-shell-meta-item">
            <span className="research-progress-shell-meta-label">Mode</span>
            <strong className="research-progress-shell-meta-value">
              {modeLabel}
            </strong>
          </div>
          <div className="research-progress-shell-meta-item">
            <span className="research-progress-shell-meta-label">Scope</span>
            <strong className="research-progress-shell-meta-value">
              {styleLabel}
            </strong>
          </div>
          <div className="research-progress-shell-meta-item">
            <span className="research-progress-shell-meta-label">Status</span>
            <strong className="research-progress-shell-meta-value">
              {progressLabel}
            </strong>
          </div>
          <div className="research-progress-shell-meta-item">
            <span className="research-progress-shell-meta-label">Sections</span>
            <strong className="research-progress-shell-meta-value">
              {draftedCount}/{sections.length}
            </strong>
          </div>
          <div className="research-progress-shell-meta-item">
            <span className="research-progress-shell-meta-label">Refs</span>
            <strong className="research-progress-shell-meta-value">
              {citations.length}
            </strong>
          </div>
          <div className="research-progress-shell-meta-item">
            <span className="research-progress-shell-meta-label">Updated</span>
            <strong className="research-progress-shell-meta-value">
              {formatUpdated(artifact.updatedAt || payload.generatedAt)}
            </strong>
          </div>
          {currentSection ? (
            <div className="research-progress-shell-meta-item is-wide">
              <span className="research-progress-shell-meta-label">
                Current
              </span>
              <strong className="research-progress-shell-meta-value">
                {trimHeading(currentSection.heading)}
              </strong>
            </div>
          ) : null}
        </div>

        <section className="research-progress-shell-progress-block">
          <div className="research-progress-shell-progress-row">
            <div className="research-progress-shell-progress-track">
              <span
                className={`research-progress-shell-progress-fill${reportStatus === 'complete' ? ' is-complete' : ''}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="research-progress-shell-progress-value">
              {Math.round(pct)}%
            </span>
          </div>
          <p className="research-progress-shell-summary">
            {statusCopy(
              reportStatus,
              currentSection?.heading ?? null,
              draftedCount,
              sections.length,
            )}
          </p>
          <div className="research-progress-shell-strip" role="list">
            {sections.map((section, idx) => {
              const sectionStatus = section.status ?? 'empty'
              const isCurrent =
                currentSection?.id === section.id && reportStatus !== 'complete'
              return (
                <div
                  key={section.id}
                  role="listitem"
                  className={
                    'research-progress-shell-step' +
                    ` is-${sectionStatus}` +
                    (isCurrent ? ' is-current' : '')
                  }
                  title={section.heading}
                >
                  <SectionStatusDot status={sectionStatus} />
                  <span className="research-progress-shell-step-num">
                    §{idx + 1}
                  </span>
                  <span className="research-progress-shell-step-label">
                    {trimHeading(section.heading)}
                  </span>
                </div>
              )
            })}
          </div>
        </section>

        {hasUnverifiedCitations ? (
          <div className="research-card-banner" role="note">
            <AlertTriangle size={13} className="research-card-banner-icon" />
            <span>
              Citations drafted by LLM — not yet verified against a source
              library. Double-check each reference before reusing.
            </span>
          </div>
        ) : null}

        <div className="research-progress-shell-body">
          <ResearchReportArtifactCard
            artifact={artifact}
            chrome="content-only"
            bodyScrollRef={bodyScrollRef}
          />
        </div>
      </div>
    </div>
  )
}
