// Right pane: selected chain detail, nodes table, extraction metadata, tag
// editor, context excerpt. Extracted verbatim from
// ../KnowledgeBrowserModal.tsx.

import { FileText, Loader2, Sparkles, X } from 'lucide-react'

import EmptyState from '../../common/EmptyState'
import Skeleton from '../../common/Skeleton'
import type { ChainNode } from '../../../types/library-api'
import type {
  KnowledgeChainMatch,
  KnowledgeExtractionDetail,
} from '../../../types/knowledge-api'
import { roleBadge } from './types'

export default function DetailPane({
  match,
  detail,
  detailLoading,
  canEdit,
  tagDraft,
  onTagDraftChange,
  onAddTag,
  onRemoveTag,
  addBusy,
  removeBusy,
}: {
  match: KnowledgeChainMatch | null
  detail: KnowledgeExtractionDetail | null
  detailLoading: boolean
  canEdit: boolean
  tagDraft: string
  onTagDraftChange: (v: string) => void
  onAddTag: (extractionId: number, tag: string) => void
  onRemoveTag: (extractionId: number, tag: string) => void
  addBusy: boolean
  removeBusy: boolean
}) {
  if (!match) {
    return (
      <div className="knowledge-browser-right-pane">
        <EmptyState
          variant="no-data"
          size="sm"
          title="Select a chain"
          description="Pick a result on the left to see node details."
        />
      </div>
    )
  }
  // Detail lookup lags selection; treat belonging to a different extraction as
  // "not yet loaded" so we don't show the previous selection's metadata.
  const detailForMatch =
    detail && detail.id === match.extraction_id ? detail : null
  const extractionId = match.extraction_id
  const tags = detailForMatch?.tags ?? []
  return (
    <div className="knowledge-browser-right-pane">
      <div className="knowledge-browser-pane-label">Chain Detail</div>
      <div className="knowledge-browser-detail-title">
        {match.paper_title ?? `extraction #${match.extraction_id}`}
      </div>
      <div className="knowledge-browser-detail-meta">
        chain #{match.chain_id}
        {match.chain_type ? ` · ${match.chain_type}` : ''}
        {typeof match.confidence === 'number'
          ? ` · conf ${match.confidence.toFixed(2)}`
          : ''}
      </div>
      {match.context_section && (
        <div className="knowledge-browser-section-ref">
          § {match.context_section}
        </div>
      )}
      <div className="knowledge-browser-nodes-list">
        {match.nodes.map((n: ChainNode, i) => (
          <div key={i} className="knowledge-browser-node-card">
            <div className="knowledge-browser-node-card-hdr">
              <span
                className="knowledge-browser-role-pill"
                style={roleBadge(n.role)}
              >
                {n.role}
              </span>
              <strong className="knowledge-browser-node-name">{n.name}</strong>
            </div>
            {n.value != null && (
              <div className="knowledge-browser-node-value-row">
                <Sparkles size={10} />
                <span className="knowledge-browser-node-value-text">
                  {String(n.value)}
                  {n.unit ? ` ${n.unit}` : ''}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="knowledge-browser-extraction-section">
        <div className="knowledge-browser-section-label">
          <FileText size={10} /> Extraction
          {detailLoading && !detailForMatch && (
            <Loader2
              size={10}
              className="spin knowledge-browser-muted-icon"
            />
          )}
        </div>
        <DetailRow label="ID" value={`#${extractionId}`} mono />
        {detailForMatch?.doi && (
          <DetailRow label="DOI" value={detailForMatch.doi} mono />
        )}
        {detailForMatch?.extracted_at && (
          <DetailRow
            label="At"
            value={formatTimestamp(detailForMatch.extracted_at)}
            mono
          />
        )}
        {typeof detailForMatch?.chain_count === 'number' && (
          <DetailRow
            label="Counts"
            value={`${detailForMatch.chain_count} chains · ${
              detailForMatch.node_count ?? 0
            } nodes · ${detailForMatch.table_count ?? 0} tables`}
            mono
          />
        )}
        {detailForMatch?.source_path && (
          <DetailRow
            label="Source"
            value={detailForMatch.source_path}
            mono
            title={detailForMatch.source_path}
            ellipsis
          />
        )}
        {typeof detailForMatch?.project_id === 'number' && (
          <DetailRow
            label="Project"
            value={`#${detailForMatch.project_id}`}
            mono
          />
        )}

        <div className="knowledge-browser-detail-row knowledge-browser-detail-row--top">
          <span className="knowledge-browser-detail-key">Tags</span>
          <div className="knowledge-browser-chip-row-inline">
            {!detailForMatch && detailLoading && (
              <Skeleton rows={2} width="60%" />
            )}
            {detailForMatch && tags.length === 0 && (
              <span className="knowledge-browser-empty-hint">none</span>
            )}
            {tags.map((t) => (
              <span key={t} className="knowledge-browser-chip-removable">
                {t}
                {canEdit && extractionId != null && (
                  <button
                    type="button"
                    onClick={() => onRemoveTag(extractionId, t)}
                    disabled={removeBusy}
                    className="knowledge-browser-chip-del"
                    title="Remove tag"
                  >
                    <X size={8} />
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
        {canEdit && extractionId != null && (
          <div className="knowledge-browser-tag-input-row">
            <input
              value={tagDraft}
              onChange={(e) => onTagDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && tagDraft.trim()) {
                  onAddTag(extractionId, tagDraft.trim())
                }
              }}
              disabled={addBusy}
              placeholder="+ add tag"
              className="knowledge-browser-tag-input"
            />
          </div>
        )}
      </div>

      {match.context_text && (
        <details className="knowledge-browser-context-box">
          <summary className="knowledge-browser-context-summary">
            Context
          </summary>
          <div className="knowledge-browser-context-body">
            {match.context_text}
          </div>
        </details>
      )}
    </div>
  )
}

function DetailRow({
  label,
  value,
  mono,
  title,
  ellipsis,
}: {
  label: string
  value: string
  mono?: boolean
  title?: string
  ellipsis?: boolean
}) {
  return (
    <div className="knowledge-browser-detail-row" title={title}>
      <span className="knowledge-browser-detail-key">{label}</span>
      <span
        className={[
          'knowledge-browser-detail-value',
          mono ? 'knowledge-browser-detail-value--mono' : '',
          ellipsis ? 'knowledge-browser-detail-value--ellipsis' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {value}
      </span>
    </div>
  )
}

function formatTimestamp(raw: string): string {
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw
  return d.toLocaleString()
}
