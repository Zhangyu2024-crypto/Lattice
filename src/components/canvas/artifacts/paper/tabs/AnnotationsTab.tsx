import {
  Check,
  ChevronRight,
  Edit2,
  Highlighter,
  Info,
  Loader2,
  MessageSquare,
  Trash2,
  X,
} from 'lucide-react'
import type { PaperAnnotation } from '../../../../../types/library-api'
import {
  Badge,
  Disclosure,
  EmptyState,
  IconButton,
} from '../../../../ui'

export type SideTab = 'annotations' | 'ai' | 'info'

const HIGHLIGHT_COLOR_PRESETS = [
  '#F5F5F5',
  '#D4D4D4',
  '#B0B0B0',
  '#888888',
  '#606060',
  '#3A3A3A',
]

export default function AnnotationsTab({
  annotations,
  loading,
  onDelete,
  editingAnnId,
  editDraftContent,
  editDraftColor,
  editSaving,
  onEditStart,
  onEditContentChange,
  onEditColorChange,
  onEditSave,
  onEditCancel,
  canEdit,
  onNavigateTab,
}: {
  annotations: PaperAnnotation[]
  loading: boolean
  onDelete: (id: number) => void
  editingAnnId: number | null
  editDraftContent: string
  editDraftColor: string
  editSaving: boolean
  onEditStart: (ann: PaperAnnotation) => void
  onEditContentChange: (v: string) => void
  onEditColorChange: (v: string) => void
  onEditSave: (ann: PaperAnnotation) => void
  onEditCancel: () => void
  canEdit: boolean
  onNavigateTab: (t: SideTab) => void
}) {
  if (loading) {
    return (
      <EmptyState
        compact
        icon={<Loader2 size={16} className="spin" />}
        title="Loading..."
      />
    )
  }
  if (annotations.length === 0) {
    return (
      <div className="card-paper-annotations-empty">
        <div className="card-paper-annotations-empty-head">
          <Highlighter
            size={15}
            strokeWidth={2}
            className="card-paper-annotations-empty-head-icon"
            aria-hidden
          />
          <span className="card-paper-annotations-empty-head-title">
            Annotations
          </span>
        </div>
        <p className="card-paper-annotations-empty-blurb">
          Select text in the PDF, then <strong>Highlight</strong> or{' '}
          <strong>Note</strong> from the menu — items list here.
        </p>
        <Disclosure
          title="Step-by-step"
          className="card-paper-annotations-empty-disclosure"
        >
          <ol className="card-paper-annotations-empty-steps">
            <li>Select text in the PDF.</li>
            <li>
              Choose <strong>Highlight</strong> or <strong>Note</strong> in the
              floating menu.
            </li>
            <li>Edit, recolor, or delete from this tab.</li>
          </ol>
        </Disclosure>
        {!canEdit ? (
          <p className="card-paper-annotations-empty-warn">
            Library backend is not ready — annotations may be unavailable until it
            connects.
          </p>
        ) : null}
        <p className="card-paper-annotations-empty-more-label">Open tab</p>
        <ul className="card-paper-rail-tiles card-paper-rail-tiles--compact">
          <li>
            <button
              type="button"
              className="card-paper-rail-tile card-paper-rail-tile--compact"
              onClick={() => onNavigateTab('ai')}
              title="Chat with this paper’s full text"
            >
              <MessageSquare size={14} className="card-paper-rail-tile-icon" aria-hidden />
              <span className="card-paper-rail-tile-title">AI Ask</span>
              <ChevronRight size={14} className="card-paper-rail-tile-chevron" aria-hidden />
            </button>
          </li>
          <li>
            <button
              type="button"
              className="card-paper-rail-tile card-paper-rail-tile--compact"
              onClick={() => onNavigateTab('info')}
              title="Metadata, full text, extractions"
            >
              <Info size={14} className="card-paper-rail-tile-icon" aria-hidden />
              <span className="card-paper-rail-tile-title">Details</span>
              <ChevronRight size={14} className="card-paper-rail-tile-chevron" aria-hidden />
            </button>
          </li>
        </ul>
      </div>
    )
  }
  return (
    <div className="card-paper-scroll-col">
      {annotations.map((a) => {
        const isEditing = editingAnnId === a.id
        // The left accent bar tracks the highlight color live during editing,
        // otherwise reflects the saved color (or the neutral preset fallback).
        const accent =
          isEditing && a.type === 'highlight' ? editDraftColor : a.color || '#D4D4D4'
        return (
          <div
            key={a.id}
            className="card-paper-ann-card"
            style={{ '--ann-color': accent } as React.CSSProperties}
          >
            <div className="card-paper-ann-head">
              <Badge variant="info" className="card-paper-ann-page">p.{a.page}</Badge>
              <span className="card-paper-ann-type">{a.type}</span>
              <span className="card-paper-spacer" />
              {!isEditing && canEdit && (
                <IconButton
                  icon={<Edit2 size={11} />}
                  label="Edit"
                  onClick={() => onEditStart(a)}
                />
              )}
              {isEditing && (
                <>
                  <IconButton
                    icon={editSaving ? <Loader2 size={11} className="spin" /> : <Check size={11} />}
                    label="Save"
                    onClick={() => onEditSave(a)}
                    disabled={editSaving}
                  />
                  <IconButton
                    icon={<X size={11} />}
                    label="Cancel"
                    onClick={onEditCancel}
                    disabled={editSaving}
                  />
                </>
              )}
              <IconButton
                icon={<Trash2 size={11} />}
                label="Delete"
                onClick={() => onDelete(a.id)}
                disabled={isEditing}
              />
            </div>
            {isEditing ? (
              a.type === 'highlight' ? (
                <div className="card-paper-ann-edit-color-row">
                  {HIGHLIGHT_COLOR_PRESETS.map((c) => {
                    const active = c.toLowerCase() === editDraftColor.toLowerCase()
                    return (
                      <button
                        key={c}
                        onClick={() => onEditColorChange(c)}
                        className={`card-paper-ann-color-swatch${active ? ' is-active' : ''}`}
                        style={{ '--swatch-color': c } as React.CSSProperties}
                        title={c}
                      />
                    )
                  })}
                </div>
              ) : (
                <textarea
                  value={editDraftContent}
                  onChange={(e) => onEditContentChange(e.target.value)}
                  className="card-paper-ann-edit-textarea"
                  rows={3}
                  disabled={editSaving}
                  autoFocus
                />
              )
            ) : (
              <div className="card-paper-ann-content">{a.content}</div>
            )}
          </div>
        )
      })}
    </div>
  )
}
