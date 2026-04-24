import { useCallback, useMemo, useState } from 'react'
import {
  Bookmark,
  FileText,
  FolderOpen,
  PanelLeftClose,
  Search,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import {
  useArtifactDbStore,
  queryDbEntries,
} from '../../../stores/artifact-db-store'
import { toast } from '../../../stores/toast-store'
import type { DbIndexEntry } from '../../../types/artifact-db'
import type { ArtifactKind } from '../../../types/artifact'

const KIND_ICON_LABEL: Partial<Record<ArtifactKind, string>> = {
  spectrum: 'Spec',
  'peak-fit': 'Peaks',
  'xrd-analysis': 'XRD',
  'xps-analysis': 'XPS',
  'raman-id': 'Raman',
  structure: 'Struct',
  compute: 'Code',
  'compute-pro': 'Code Lab',
  job: 'Job',
  'research-report': 'Report',
  plot: 'Plot',
  'latex-document': 'LaTeX',
  paper: 'Paper',
  'xrd-pro': 'XRD Lab',
  'xps-pro': 'XPS Lab',
  'raman-pro': 'Raman Lab',
  'curve-pro': 'Curve Lab',
  'spectrum-pro': 'Spec Lab',
}

interface Props {
  onCollapseSidebar?: () => void
}

export default function ArtifactDbSidebarView({ onCollapseSidebar }: Props) {
  const index = useArtifactDbStore((s) => s.index)
  const filter = useArtifactDbStore((s) => s.filter)
  const collections = useArtifactDbStore((s) => s.collections)
  const globalTags = useArtifactDbStore((s) => s.globalTags)
  const setFilter = useArtifactDbStore((s) => s.setFilter)
  const resetFilter = useArtifactDbStore((s) => s.resetFilter)
  const removeEntry = useArtifactDbStore((s) => s.removeEntry)
  const selectedEntryId = useArtifactDbStore((s) => s.selectedEntryId)
  const setSelectedEntryId = useArtifactDbStore((s) => s.setSelectedEntryId)

  const [showFilters, setShowFilters] = useState(false)

  const filtered = useMemo(
    () => queryDbEntries(index, filter),
    [index, filter],
  )

  const hasActiveFilter =
    filter.search !== '' ||
    filter.tags.length > 0 ||
    filter.artifactKinds.length > 0 ||
    filter.rating != null

  const handleRemove = useCallback(
    (id: string) => {
      void removeEntry(id).then(() => toast.info('Removed from database'))
    },
    [removeEntry],
  )

  return (
    <div className="sidebar-space-view">
      <div className="sidebar-header is-split">
        <span>
          <Bookmark size={13} style={{ marginRight: 6, verticalAlign: -2 }} />
          Artifact Database
        </span>
        <div className="sidebar-header-actions">
          {onCollapseSidebar ? (
            <button
              type="button"
              onClick={onCollapseSidebar}
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
              className="session-mini-btn"
            >
              <PanelLeftClose size={14} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="artifact-db-toolbar">
        <div className="artifact-db-search">
          <Search size={12} className="artifact-db-search-icon" />
          <input
            type="text"
            placeholder="Search bookmarks…"
            value={filter.search}
            onChange={(e) => setFilter({ search: e.target.value })}
            className="artifact-db-search-input"
          />
          {filter.search ? (
            <button
              type="button"
              className="artifact-db-search-clear"
              onClick={() => setFilter({ search: '' })}
              aria-label="Clear search"
            >
              <X size={10} />
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className={`artifact-db-filter-toggle ${showFilters ? 'active' : ''}`}
          onClick={() => setShowFilters((v) => !v)}
          title="Toggle filters"
        >
          Filters
          {hasActiveFilter ? (
            <span className="artifact-db-filter-badge" />
          ) : null}
        </button>
      </div>

      {showFilters ? (
        <div className="artifact-db-filter-panel">
          {globalTags.length > 0 ? (
            <div className="artifact-db-filter-row">
              <span className="artifact-db-filter-label">Tags</span>
              <div className="artifact-db-filter-chips">
                {globalTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className={`artifact-db-chip ${filter.tags.includes(tag) ? 'active' : ''}`}
                    onClick={() =>
                      setFilter({
                        tags: filter.tags.includes(tag)
                          ? filter.tags.filter((t) => t !== tag)
                          : [...filter.tags, tag],
                      })
                    }
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {collections.length > 0 ? (
            <div className="artifact-db-filter-row">
              <span className="artifact-db-filter-label">Collections</span>
              <div className="artifact-db-filter-chips">
                {collections.map((col) => (
                  <button
                    key={col.id}
                    type="button"
                    className={`artifact-db-chip ${filter.collectionIds.includes(col.id) ? 'active' : ''}`}
                    onClick={() =>
                      setFilter({
                        collectionIds: filter.collectionIds.includes(col.id)
                          ? filter.collectionIds.filter((c) => c !== col.id)
                          : [...filter.collectionIds, col.id],
                      })
                    }
                  >
                    {col.color ? (
                      <span
                        className="artifact-db-chip-dot"
                        style={{ background: col.color }}
                      />
                    ) : (
                      <FolderOpen size={10} />
                    )}
                    {col.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {hasActiveFilter ? (
            <button
              type="button"
              className="artifact-db-clear-filters"
              onClick={resetFilter}
            >
              Clear all filters
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="artifact-db-count">
        {filtered.length} bookmark{filtered.length === 1 ? '' : 's'}
        {hasActiveFilter ? ' (filtered)' : ''}
      </div>

      <div className="artifact-db-list">
        {filtered.length === 0 ? (
          <div className="artifact-db-empty">
            {index.length === 0 ? (
              <>
                <Bookmark size={28} strokeWidth={1.2} />
                <span>No bookmarks yet</span>
                <span className="artifact-db-empty-hint">
                  Bookmark artifacts from chat cards or the workbench action menu
                </span>
              </>
            ) : (
              <>
                <Search size={28} strokeWidth={1.2} />
                <span>No matches</span>
              </>
            )}
          </div>
        ) : (
          filtered.map((entry) => (
            <DbEntryRow
              key={entry.id}
              entry={entry}
              isSelected={entry.id === selectedEntryId}
              onSelect={() =>
                setSelectedEntryId(
                  entry.id === selectedEntryId ? null : entry.id,
                )
              }
              onRemove={() => handleRemove(entry.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}

function DbEntryRow({
  entry,
  isSelected,
  onSelect,
  onRemove,
}: {
  entry: DbIndexEntry
  isSelected: boolean
  onSelect: () => void
  onRemove: () => void
}) {
  const kindLabel = KIND_ICON_LABEL[entry.sourceArtifactKind] ?? entry.sourceArtifactKind
  const age = formatAge(entry.createdAt)
  const sizeLabel = entry.payloadSizeEstimate > 1024
    ? `${(entry.payloadSizeEstimate / 1024).toFixed(0)}KB`
    : `${entry.payloadSizeEstimate}B`

  return (
    <div
      className={`artifact-db-row ${isSelected ? 'is-selected' : ''}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
    >
      <div className="artifact-db-row-head">
        <span className="artifact-db-row-kind">{kindLabel}</span>
        {entry.element ? (
          <span className="artifact-db-row-element">{entry.element.label}</span>
        ) : null}
        <span className="artifact-db-row-age">{age}</span>
      </div>
      <div className="artifact-db-row-title">
        <FileText size={11} className="artifact-db-row-icon" />
        {entry.title}
      </div>
      {entry.tags.length > 0 ? (
        <div className="artifact-db-row-tags">
          {entry.tags.map((tag) => (
            <span key={tag} className="artifact-db-tag">{tag}</span>
          ))}
        </div>
      ) : null}
      <div className="artifact-db-row-meta">
        <span>{sizeLabel}</span>
        {entry.rating ? (
          <span className="artifact-db-row-rating">
            <Star size={9} />
            {entry.rating}
          </span>
        ) : null}
        <button
          type="button"
          className="artifact-db-row-remove"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          title="Remove from database"
        >
          <Trash2 size={10} />
        </button>
      </div>
    </div>
  )
}

function formatAge(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`
  return `${Math.floor(days / 30)}mo`
}
