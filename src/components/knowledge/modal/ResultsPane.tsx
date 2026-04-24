// Middle pane: list of chain matches. Extracted verbatim from
// ../KnowledgeBrowserModal.tsx.

import { X } from 'lucide-react'

import EmptyState from '../../common/EmptyState'
import ListCard from '../../common/ListCard'
import type { KnowledgeChainMatch } from '../../../types/knowledge-api'
import { roleBadge, truncate, type Mode } from './types'

export default function ResultsPane({
  mode,
  results,
  selected,
  onSelect,
  ready,
  onDeleteExtraction,
}: {
  mode: Mode
  results: KnowledgeChainMatch[]
  selected: KnowledgeChainMatch | null
  onSelect: (r: KnowledgeChainMatch) => void
  ready: boolean
  onDeleteExtraction: (id: number) => void
}) {
  return (
    <div className="knowledge-browser-middle-pane">
      <div className="knowledge-browser-middle-header">
        <span className="knowledge-browser-pane-label">
          Results ({results.length}) · {mode}
        </span>
      </div>
      <div className="knowledge-browser-results-list">
        {!ready && (
          <EmptyState
            variant="disconnected"
            size="sm"
            title="Backend not connected"
            description="Chains will appear once lattice-cli is running."
          />
        )}
        {ready && results.length === 0 && (
          <EmptyState
            variant="no-results"
            size="sm"
            title="No matching chains"
            description="Tweak the filters or run an agent extraction to populate the database."
          />
        )}
        {results.map((r, i) => {
          const isActive = selected?.chain_id === r.chain_id
          const paperLabel =
            truncate(r.paper_title, 70) || `extraction #${r.extraction_id}`
          return (
            <ListCard
              key={`${r.chain_id}-${i}`}
              selected={isActive}
              onSelect={() => onSelect(r)}
              ariaLabel={`Chain #${r.chain_id} — ${paperLabel}`}
              className="knowledge-browser-chain-card"
            >
              <div className="knowledge-browser-chain-top">
                <span className="knowledge-browser-chain-paper">
                  {paperLabel}
                </span>
                <span className="knowledge-browser-chain-spacer" />
                {typeof r.confidence === 'number' && (
                  <span className="knowledge-browser-chain-score">
                    {r.confidence.toFixed(2)}
                  </span>
                )}
                {r.extraction_id != null && (
                  <button
                    type="button"
                    data-list-card-skip
                    onClick={(e) => {
                      e.stopPropagation()
                      onDeleteExtraction(r.extraction_id!)
                    }}
                    className="knowledge-browser-icon-btn"
                    title="Delete extraction"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              <div className="knowledge-browser-chain-flow">
                {r.nodes.slice(0, 6).map((n, idx) => (
                  <span
                    key={`${n.role}-${idx}`}
                    className="knowledge-browser-chain-node-badge"
                    style={roleBadge(n.role)}
                    title={`${n.role}: ${n.name}${
                      n.value ? ` = ${n.value}` : ''
                    }`}
                  >
                    {n.name}
                    {n.value ? (
                      <span className="knowledge-browser-node-val">
                        {' '}
                        = {n.value}
                        {n.unit ? ` ${n.unit}` : ''}
                      </span>
                    ) : null}
                  </span>
                ))}
                {r.nodes.length > 6 && (
                  <span className="knowledge-browser-more-badge">
                    +{r.nodes.length - 6} more
                  </span>
                )}
              </div>
              {r.context_text && (
                <div className="knowledge-browser-chain-context">
                  {truncate(r.context_text, 180)}
                </div>
              )}
            </ListCard>
          )
        })}
      </div>
    </div>
  )
}
