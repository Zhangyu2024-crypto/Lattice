// Right pane: the numbered references list. Clicking a ref jumps the
// body pane to the first section that cites it; the body pane's cite
// pill clicks flash the matching entry here via the parent-owned
// `registerCitation` ref map.

import { ExternalLink, Link2 } from 'lucide-react'
import ResearchScrollRail from './ResearchScrollRail'
import type { Citation } from './types'

export default function ReferencesPane({
  citations,
  citationIndex,
  citedInBySection,
  isPlanning,
  isDrafting,
  scrollRef,
  registerCitation,
  onJumpToCitationSource,
}: {
  citations: Citation[]
  citationIndex: Map<string, number>
  citedInBySection: Map<string, number[]>
  isPlanning: boolean
  isDrafting: boolean
  scrollRef: React.RefObject<HTMLDivElement | null>
  registerCitation: (id: string, el: HTMLElement | null) => void
  onJumpToCitationSource: (id: string) => void
}) {
  return (
    <aside className="research-card-refs" aria-label="References">
      <div className="research-card-pane-header">
        References
        {citations.length > 0 && (
          <span className="research-card-pane-count">
            {citations.length}
          </span>
        )}
      </div>
      <div className="research-card-scroll-shell is-refs">
        <div ref={scrollRef} className="research-card-refs-scroll">
          {citations.length === 0 ? (
            <div className="research-card-refs-empty">
              {isPlanning || isDrafting
                ? 'Citations will appear here as sections are drafted.'
                : 'No citations recorded.'}
            </div>
          ) : (
            <ol className="research-card-refs-list">
              {citations.map((c) => {
                const n = citationIndex.get(c.id) ?? 0
                const citedIn = citedInBySection.get(c.id) ?? []
                return (
                  <li
                    key={c.id}
                    ref={(el) => {
                      registerCitation(c.id, el)
                    }}
                    className="research-card-ref"
                  >
                    <button
                      type="button"
                      className="research-card-ref-jump"
                      onClick={() => onJumpToCitationSource(c.id)}
                      title="Jump to first section that cites this"
                    >
                      [{n}]
                    </button>
                    <div className="research-card-ref-body">
                      <div className="research-card-ref-title">{c.title}</div>
                      <div className="research-card-ref-meta">
                        {c.authors.join(', ')} · {c.year}
                        {c.venue ? ` · ${c.venue}` : ''}
                      </div>
                      <div className="research-card-ref-links">
                        {c.doi && (
                          <a
                            href={`https://doi.org/${c.doi}`}
                            target="_blank"
                            rel="noreferrer"
                            className="research-card-ref-link"
                          >
                            <Link2
                              size={10}
                              className="research-card-ref-link-icon"
                            />
                            doi:{c.doi}
                          </a>
                        )}
                        {!c.doi && c.url && (
                          <a
                            href={c.url}
                            target="_blank"
                            rel="noreferrer"
                            className="research-card-ref-link"
                          >
                            <ExternalLink
                              size={10}
                              className="research-card-ref-link-icon"
                            />
                            link
                          </a>
                        )}
                        {c.unverified && (
                          <span
                            className="research-card-ref-unverified"
                            title="Not verified against a source library"
                          >
                            unverified
                          </span>
                        )}
                      </div>
                      {citedIn.length > 0 && (
                        <div className="research-card-ref-cited">
                          {citedIn.map((i) => `§${i}`).join(' · ')}
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
        <ResearchScrollRail targetRef={scrollRef} />
      </div>
    </aside>
  )
}
