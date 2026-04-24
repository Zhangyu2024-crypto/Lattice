import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Loader2 } from 'lucide-react'
import type { PaperExtractionSummary } from '../../../../../types/library-api'
import type { PaperArtifactPayload } from '../../../../../stores/demo-library'
import { Disclosure, MetaRow } from '../../../../ui'

export default function InfoTab({
  metadata,
  paperId,
  annotationCount,
  chainCount,
  backendAvailable,
  extractions,
  extractionsLoading,
  fullText,
  fullTextLoading,
  fullTextError,
  showFullText,
  onToggleFullText,
}: {
  metadata: PaperArtifactPayload['metadata']
  paperId: number | null
  annotationCount: number
  chainCount: number
  backendAvailable: boolean
  extractions: PaperExtractionSummary[] | null
  extractionsLoading: boolean
  fullText: string | null
  fullTextLoading: boolean
  fullTextError: string | null
  showFullText: boolean
  onToggleFullText: () => void
}) {
  // Details tab — shows only *derived* metadata (system IDs, counts,
  // extractions, full-text lazy-load). Intentionally does NOT render
  // title / authors / year / venue / abstract — those are already in
  // the card's top bar and `AbstractFallback`. See Wave 5 plan.
  const extractionCount = extractions?.length ?? 0
  return (
    <div className="card-paper-scroll-col card-paper-details">
      <div className="card-paper-details-identifiers">
        {paperId != null && (
          <MetaRow label="Paper ID" value={paperId} mono />
        )}
        {metadata.doi && <MetaRow label="DOI" value={metadata.doi} mono />}
        <MetaRow label="Annotations" value={annotationCount} />
        <MetaRow label="Knowledge chains" value={chainCount} />
        <MetaRow label="Extractions" value={extractionCount} />
      </div>

      <Disclosure
        title="Extractions"
        summary={!backendAvailable ? 'offline' : extractionCount || undefined}
        defaultOpen={extractionCount > 0}
      >
        {!backendAvailable ? (
          <div className="card-paper-info-offline">Not available offline</div>
        ) : extractionsLoading && extractions == null ? (
          <div className="card-paper-info-loading">
            <Loader2 size={12} className="spin" /> Loading...
          </div>
        ) : extractions == null || extractions.length === 0 ? (
          <div className="card-paper-info-offline">No extractions yet.</div>
        ) : (
          <div className="card-paper-extract-table">
            <div className="card-paper-extract-head-row">
              <span className="card-paper-extract-title-cell">Title</span>
              <span className="card-paper-extract-num-cell">Chains</span>
              <span className="card-paper-extract-num-cell">Nodes</span>
              <span className="card-paper-extract-num-cell">Sec</span>
              <span className="card-paper-extract-num-cell">Tbl</span>
            </div>
            {extractions.map((e) => (
              <div key={e.id} className="card-paper-extract-row">
                <span className="card-paper-extract-title-cell" title={e.title}>
                  {e.title}
                </span>
                <span className="card-paper-extract-num-cell">{e.chain_count}</span>
                <span className="card-paper-extract-num-cell">{e.node_count}</span>
                <span className="card-paper-extract-num-cell">{e.section_count}</span>
                <span className="card-paper-extract-num-cell">{e.table_count}</span>
              </div>
            ))}
          </div>
        )}
      </Disclosure>

      <Disclosure
        title="Full text"
        summary={!backendAvailable ? 'offline' : undefined}
        open={showFullText && backendAvailable}
        onOpenChange={() => {
          // Only fire the load/toggle when the backend is available; a
          // disabled row must not trigger a request or flip state.
          if (backendAvailable) onToggleFullText()
        }}
      >
        {fullTextLoading ? (
          <div className="card-paper-info-loading">
            <Loader2 size={12} className="spin" /> Loading full text...
          </div>
        ) : fullTextError ? (
          <div className="card-paper-info-error">Error: {fullTextError}</div>
        ) : fullText ? (
          <div className="card-paper-full-text-md">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{fullText}</ReactMarkdown>
          </div>
        ) : (
          <div className="card-paper-info-offline">No text available.</div>
        )}
      </Disclosure>
    </div>
  )
}
