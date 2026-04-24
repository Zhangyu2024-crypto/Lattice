// Center pane: numbered sections rendered as markdown with inline cite
// pills. Parent hands in a shared scroll ref (for print scoping +
// IntersectionObserver root) and a section-ref registrar (for
// scroll-to-section jumps).

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { HeadingForLevel } from './bits'
import { buildMarkdownComponents } from './helpers'
import ResearchScrollRail from './ResearchScrollRail'
import type { Citation, ReportSection } from './types'
import { useGrabScroll } from './useGrabScroll'

export default function BodyPane({
  sections,
  citations,
  citationIndex,
  onCiteClick,
  scrollRef,
  registerSection,
}: {
  sections: ReportSection[]
  citations: Citation[]
  citationIndex: Map<string, number>
  onCiteClick: (id: string) => void
  scrollRef: React.RefObject<HTMLDivElement | null>
  registerSection: (idx: number, el: HTMLElement | null) => void
}) {
  const { isDragging, dragBind } = useGrabScroll(scrollRef)

  return (
    <div className="research-card-scroll-shell is-body">
      <div
        ref={scrollRef}
        className={
          'research-card-sections research-report-md is-grab-scroll' +
          (isDragging ? ' is-grabbing' : '')
        }
        {...dragBind}
      >
        {sections.map((sec, idx) => {
          const secStatus: 'empty' | 'drafting' | 'done' =
            sec.status ?? 'done'
          return (
            <section
              key={sec.id}
              ref={(el) => {
                registerSection(idx, el)
              }}
              data-section-idx={idx}
              className="research-card-section"
            >
              <div className="research-card-section-head">
                <span className="research-card-section-num">§{idx + 1}</span>
                <HeadingForLevel level={sec.level}>
                  {sec.heading}
                </HeadingForLevel>
              </div>
              {secStatus === 'done' || sec.markdown.trim().length > 0 ? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={buildMarkdownComponents(
                    citationIndex,
                    citations,
                    onCiteClick,
                  )}
                >
                  {sec.markdown}
                </ReactMarkdown>
              ) : (
                <div className="research-card-section-placeholder">
                  {secStatus === 'drafting' ? (
                    <>
                      <span className="research-card-pulse" />
                      Drafting…
                    </>
                  ) : (
                    <>
                      <span className="research-card-empty-dot" />
                      Queued
                    </>
                  )}
                </div>
              )}
            </section>
          )
        })}
      </div>
      <ResearchScrollRail targetRef={scrollRef} />
    </div>
  )
}
