// Left pane of the research-report card — sticky outline of section
// headings with an "active" marker fed by the parent's
// IntersectionObserver. Pure: parent owns state, this renders + emits.

import { useRef } from 'react'
import { SectionStatusDot } from './bits'
import ResearchScrollRail from './ResearchScrollRail'
import type { ReportSection } from './types'

export default function OutlinePane({
  sections,
  activeIdx,
  onJumpToSection,
}: {
  sections: ReportSection[]
  activeIdx: number
  onJumpToSection: (idx: number) => void
}) {
  const listRef = useRef<HTMLDivElement | null>(null)

  return (
    <aside className="research-card-outline" aria-label="Section outline">
      <div className="research-card-pane-header">Outline</div>
      <div className="research-card-scroll-shell is-outline">
        <div ref={listRef} className="research-card-outline-list">
          {sections.map((sec, idx) => {
            const active = idx === activeIdx
            const secStatus: 'empty' | 'drafting' | 'done' =
              sec.status ?? 'done'
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => onJumpToSection(idx)}
                className={`research-card-outline-item${active ? ' is-active' : ''}`}
                style={{ '--level': sec.level } as React.CSSProperties}
                title={sec.heading}
              >
                <SectionStatusDot status={secStatus} />
                <span className="research-card-outline-label">
                  {sec.heading}
                </span>
                <span className="research-card-outline-num">§{idx + 1}</span>
              </button>
            )
          })}
        </div>
        <ResearchScrollRail targetRef={listRef} />
      </div>
    </aside>
  )
}
