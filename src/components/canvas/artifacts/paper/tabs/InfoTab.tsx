import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Loader2 } from 'lucide-react'
import type { PaperArtifactPayload } from '../../../../../stores/demo-library'
import { Disclosure, MetaRow } from '../../../../ui'

export default function InfoTab({
  metadata,
  paperId,
  annotationCount,
  localTextAvailable,
  fullText,
  fullTextLoading,
  fullTextError,
  showFullText,
  onToggleFullText,
}: {
  metadata: PaperArtifactPayload['metadata']
  paperId: number | null
  annotationCount: number
  localTextAvailable: boolean
  fullText: string | null
  fullTextLoading: boolean
  fullTextError: string | null
  showFullText: boolean
  onToggleFullText: () => void
}) {
  // Details tab — shows only *derived* metadata (system IDs, counts,
  // full-text lazy-load). Intentionally does NOT render title / authors
  // / year / venue / abstract — those are already in the card's top
  // bar and `AbstractFallback`.
  return (
    <div className="card-paper-scroll-col card-paper-details">
      <div className="card-paper-details-identifiers">
        {paperId != null && (
          <MetaRow label="Paper ID" value={paperId} mono />
        )}
        {metadata.doi && <MetaRow label="DOI" value={metadata.doi} mono />}
        <MetaRow label="Annotations" value={annotationCount} />
      </div>

      <Disclosure
        title="Full text"
        summary={!localTextAvailable ? 'unavailable' : undefined}
        open={showFullText && localTextAvailable}
        onOpenChange={() => {
          // Only fire the load/toggle when the local paper record is available; a
          // disabled row must not trigger a request or flip state.
          if (localTextAvailable) onToggleFullText()
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
