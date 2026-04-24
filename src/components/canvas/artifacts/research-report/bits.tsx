// Small presentational bits for the research-report card: the header
// progress chip, the outline status dot, and the level-aware heading
// wrapper. None of these own state — they read props and render.

import { Check } from 'lucide-react'
import type { ReportStatus, SectionStatus } from './types'

export function StatusChip({
  status,
  totalSections,
  draftedSections,
  currentHeading,
  citationCount,
}: {
  status: ReportStatus
  totalSections: number
  draftedSections: number
  currentHeading: string | null
  citationCount: number
}) {
  if (status === 'planning') {
    return (
      <span
        className="research-card-status-chip is-planning"
        aria-live="polite"
      >
        <span className="research-card-pulse" />
        Planning outline
      </span>
    )
  }
  if (status === 'drafting') {
    const progress = `${Math.min(draftedSections + 1, totalSections)}/${totalSections}`
    return (
      <span
        className="research-card-status-chip is-drafting"
        aria-live="polite"
      >
        <span className="research-card-pulse" />
        Drafting {progress}
        {currentHeading && (
          <span className="research-card-status-chip-sub">
            · {currentHeading}
          </span>
        )}
      </span>
    )
  }
  return (
    <span className="research-card-status-chip is-complete">
      <Check size={11} strokeWidth={2.5} />
      Complete · {totalSections} section{totalSections === 1 ? '' : 's'}
      {citationCount > 0
        ? ` · ${citationCount} ref${citationCount === 1 ? '' : 's'}`
        : ''}
    </span>
  )
}

export function SectionStatusDot({ status }: { status: SectionStatus }) {
  const aria =
    status === 'done' ? 'Done' : status === 'drafting' ? 'Drafting' : 'Empty'
  return (
    <span
      className={`research-card-section-dot is-${status}`}
      aria-label={aria}
    />
  )
}

export function HeadingForLevel({
  level,
  children,
}: {
  level: 1 | 2 | 3
  children: React.ReactNode
}) {
  if (level === 1) return <h2 className="research-card-h1">{children}</h2>
  if (level === 2) return <h3 className="research-card-h2">{children}</h3>
  return <h4 className="research-card-h3">{children}</h4>
}
