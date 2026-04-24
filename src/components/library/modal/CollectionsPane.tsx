// CollectionsPane — left pane of the LibraryModal 3-pane layout.
//
// Extracted from LibraryModal.tsx. Pure presentation + event forwarding;
// it never reaches into backend APIs directly.

import { FolderPlus, Trash2 } from 'lucide-react'
import { ALL_PAPERS_ID, type Collection } from './types'

interface CollectionsPaneProps {
  collections: Collection[]
  totalPapers: number
  selectedId: string
  onSelect: (id: string) => void
  onCreate?: () => void
  onDelete?: (name: string) => void
}

export default function CollectionsPane({
  collections,
  totalPapers,
  selectedId,
  onSelect,
  onCreate,
  onDelete,
}: CollectionsPaneProps) {
  const row = (
    id: string,
    label: string,
    count: number,
    deletable = false,
  ) => {
    const active = selectedId === id
    return (
      <div
        key={id}
        className={[
          'library-modal-collection-row',
          active ? 'is-active' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <button
          onClick={() => onSelect(id)}
          className="library-modal-collection-row-btn"
        >
          <span className="library-modal-collection-row-label">{label}</span>
          <span className="library-modal-badge">{count}</span>
        </button>
        {deletable && onDelete && (
          <button
            onClick={() => onDelete(id)}
            className="library-modal-row-delete-btn"
            title="Delete collection"
          >
            <Trash2 size={10} />
          </button>
        )}
      </div>
    )
  }
  return (
    <div className="library-modal-left-pane">
      <div className="library-modal-pane-header">
        <span className="library-modal-pane-label">Collections</span>
        {onCreate && (
          <button
            onClick={onCreate}
            className="library-modal-icon-btn"
            title="New collection"
          >
            <FolderPlus size={12} />
          </button>
        )}
      </div>
      {row(ALL_PAPERS_ID, 'All Papers', totalPapers)}
      {collections.map((c) => row(c.id, c.name, c.paperCount, true))}
    </div>
  )
}
