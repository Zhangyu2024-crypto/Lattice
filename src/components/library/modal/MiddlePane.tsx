// MiddlePane — center pane of the LibraryModal 3-pane layout.
//
// Extracted from LibraryModal.tsx. Renders the search box, tag filter pills,
// DOI import row and the filtered paper list. `PaperRow` is a private helper
// used only by this pane, so it lives alongside MiddlePane.

import { FileText, Loader2, Plus, Search, Tag, Trash2 } from 'lucide-react'
import EmptyState from '../../common/EmptyState'
import ListCard from '../../common/ListCard'
import type { PaperCard } from './types'

interface MiddlePaneProps {
  papers: PaperCard[]
  query: string
  onQueryChange: (v: string) => void
  tags: string[]
  activeTags: Set<string>
  onToggleTag: (tag: string) => void
  doiValue: string
  onDoiChange: (v: string) => void
  onDoiImport: () => void
  doiBusy: boolean
  canEdit: boolean
  selectedPaperId: string | null
  onSelectPaper: (id: string) => void
  onOpenPaper: (paper: PaperCard) => void
  onDeletePaper: (paper: PaperCard) => void
}

export default function MiddlePane({
  papers,
  query,
  onQueryChange,
  tags,
  activeTags,
  onToggleTag,
  doiValue,
  onDoiChange,
  onDoiImport,
  doiBusy,
  canEdit,
  selectedPaperId,
  onSelectPaper,
  onOpenPaper,
  onDeletePaper,
}: MiddlePaneProps) {
  const doiDisabled = !canEdit || doiBusy
  return (
    <div className="library-modal-middle-pane">
      <div className="library-modal-middle-header">
        <div className="library-modal-search-row">
          <Search size={15} strokeWidth={1.75} className="library-modal-search-icon" />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search title, authors, abstract..."
            className="library-modal-search-input"
          />
        </div>
        {tags.length > 0 && (
          <div className="library-modal-tag-row">
            <Tag size={13} strokeWidth={1.75} className="library-modal-tag-icon" />
            {tags.slice(0, 20).map((t) => {
              const active = activeTags.has(t)
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => onToggleTag(t)}
                  className={[
                    'library-modal-tag-pill',
                    active ? 'is-active' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {t}
                </button>
              )
            })}
          </div>
        )}
        <div className="library-modal-doi-row">
          <input
            value={doiValue}
            onChange={(e) => onDoiChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onDoiImport()
            }}
            placeholder={
              canEdit
                ? 'Import by DOI…'
                : 'DOI import requires the desktop app'
            }
            disabled={doiDisabled}
            className="library-modal-doi-input"
          />
          <button
            type="button"
            onClick={onDoiImport}
            disabled={doiDisabled}
            className={[
              'library-modal-primary-btn',
              doiDisabled ? 'is-disabled' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {doiBusy ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <Plus size={14} strokeWidth={1.75} />
            )}
            Add
          </button>
        </div>
      </div>
      <div className="library-modal-paper-list">
        {papers.length === 0 ? (
          canEdit ? (
            <EmptyState
              variant="no-results"
              size="sm"
              title="No papers match"
              description="Clear filters or import a paper to get started."
            />
          ) : (
            <EmptyState
              variant="disconnected"
              size="sm"
              title="Local library unavailable"
              description="Showing demo papers only. Open the Electron desktop app to use your library."
            />
          )
        ) : (
          papers.map((paper) => (
            <PaperRow
              key={paper.id}
              paper={paper}
              selected={paper.id === selectedPaperId}
              canDelete={canEdit && paper.backendId != null}
              onSelect={() => onSelectPaper(paper.id)}
              onOpen={() => onOpenPaper(paper)}
              onDelete={() => onDeletePaper(paper)}
            />
          ))
        )}
      </div>
    </div>
  )
}

function PaperRow({
  paper,
  selected,
  canDelete,
  onSelect,
  onOpen,
  onDelete,
}: {
  paper: PaperCard
  selected: boolean
  canDelete: boolean
  onSelect: () => void
  onOpen: () => void
  onDelete: () => void
}) {
  const authorLabel =
    paper.authors.length === 0 || paper.authors[0] === 'Unknown'
      ? 'Unknown author'
      : paper.authors.length > 3
        ? `${paper.authors.slice(0, 3).join(', ')} et al.`
        : paper.authors.join(', ')

  return (
    <ListCard
      selected={selected}
      onSelect={onSelect}
      ariaLabel={`${paper.title} — ${paper.authors.join(', ')}`}
      trailingActions={
        <div className="library-paper-action-col">
          <button
            type="button"
            onClick={onOpen}
            className="library-paper-icon-btn library-paper-icon-btn--primary"
            title="Open paper"
            aria-label={`Open ${paper.title}`}
          >
            <FileText size={14} strokeWidth={1.75} />
          </button>
          {canDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="library-paper-icon-btn library-paper-icon-btn--danger"
              title="Delete paper"
              aria-label={`Delete ${paper.title}`}
            >
              <Trash2 size={13} strokeWidth={1.75} />
            </button>
          )}
        </div>
      }
    >
      <div className="library-paper-card-main">
        <div className="library-paper-title" title={paper.title}>
          {paper.title}
        </div>
        <div className="library-paper-meta">
          <span className="library-paper-meta-authors">{authorLabel}</span>
          {paper.year ? (
            <span className="library-paper-meta-year">{paper.year}</span>
          ) : null}
          {paper.venue ? (
            <span className="library-paper-meta-venue" title={paper.venue}>
              {paper.venue}
            </span>
          ) : null}
        </div>
        {(paper.tags.length > 0 || paper.chainCount > 0) && (
          <div className="library-paper-chip-row">
            {paper.tags.slice(0, 3).map((t) => (
              <span key={t} className="library-paper-chip">
                {t}
              </span>
            ))}
            {paper.tags.length > 3 && (
              <span className="library-paper-chip library-paper-chip--muted">
                +{paper.tags.length - 3}
              </span>
            )}
            {paper.chainCount > 0 && (
              <span className="library-paper-chip library-paper-chip--accent">
                {paper.chainCount} chain{paper.chainCount === 1 ? '' : 's'}
              </span>
            )}
          </div>
        )}
      </div>
    </ListCard>
  )
}
