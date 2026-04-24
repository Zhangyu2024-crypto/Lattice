// One row in the ChatsDropdown list. Owns its local presentation
// (title / preview / snippet / inline rename / per-row menu) but
// delegates all state mutations up to the parent via callbacks —
// keeps selection, menu-open-id, and rename-draft as single sources
// of truth in ChatsDropdown.tsx.

import { type KeyboardEvent } from 'react'
import {
  Archive,
  Check,
  FileJson,
  FileText,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-react'
import type { Session } from '../../../types/session'
import type { ExportFormat } from '../../../lib/conversation-export'
import { contentMatchSnippet, firstUserMessagePreview, relativeTime } from './helpers'

export interface ChatRowProps {
  session: Session
  active: boolean
  now: number
  renaming: boolean
  renameDraft: string
  menuOpen: boolean
  archivedView?: boolean
  /** Normalized lowercased search query — drives the content-match snippet. */
  query: string
  onClick: () => void
  onRenameDraftChange: (v: string) => void
  onCommitRename: () => void
  onCancelRename: () => void
  onRenameKey: (e: KeyboardEvent<HTMLInputElement>) => void
  onToggleMenu: () => void
  onStartRename: () => void
  onTogglePin: () => void
  onArchive: () => void
  onExport: (format: ExportFormat) => void
  onDelete: () => void
}

export function ChatRow(props: ChatRowProps) {
  const {
    session,
    active,
    now,
    renaming,
    renameDraft,
    menuOpen,
    archivedView,
    onClick,
    onRenameDraftChange,
    onCommitRename,
    onCancelRename,
    onRenameKey,
    onToggleMenu,
    onStartRename,
    onTogglePin,
    onArchive,
    onExport,
    onDelete,
    query,
  } = props
  const preview = firstUserMessagePreview(session)
  // Show a body-match snippet when the query didn't already match title /
  // first user message — helps the user see WHY a result showed up.
  const contentSnippet =
    query &&
    !session.title.toLowerCase().includes(query) &&
    !preview.toLowerCase().includes(query)
      ? contentMatchSnippet(session, query)
      : null

  return (
    <div
      className={`chats-dropdown-row${active ? ' is-active' : ''}`}
      onClick={renaming ? undefined : onClick}
      role="button"
      tabIndex={renaming ? -1 : 0}
      onKeyDown={(e) => {
        if (renaming) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      <div className="chats-dropdown-row-body">
        {renaming ? (
          <input
            type="text"
            className="chats-dropdown-rename-input"
            value={renameDraft}
            onChange={(e) => onRenameDraftChange(e.target.value)}
            onBlur={onCommitRename}
            onKeyDown={onRenameKey}
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div className="chats-dropdown-row-title-line">
            {session.pinnedAt ? (
              <Pin
                size={9}
                strokeWidth={2}
                aria-hidden
                className="chats-dropdown-row-pin-icon"
              />
            ) : null}
            <span className="chats-dropdown-row-title">
              {session.title || 'Untitled'}
            </span>
            <span className="chats-dropdown-row-time">
              {relativeTime(session.updatedAt, now)}
            </span>
          </div>
        )}
        {preview ? (
          <div className="chats-dropdown-row-preview">{preview}</div>
        ) : null}
        {contentSnippet ? (
          <div className="chats-dropdown-row-match">{contentSnippet}</div>
        ) : null}
      </div>
      <div className="chats-dropdown-row-menu-slot">
        <button
          type="button"
          className="chats-dropdown-row-menu-btn"
          onClick={(e) => {
            e.stopPropagation()
            onToggleMenu()
          }}
          aria-label="More actions"
          title="More actions"
        >
          <MoreHorizontal size={12} aria-hidden />
        </button>
        {menuOpen && (
          <div
            className="chats-dropdown-row-menu"
            onClick={(e) => e.stopPropagation()}
            role="menu"
          >
            <MenuItem onClick={onStartRename}>
              <Pencil size={11} aria-hidden /> Rename
            </MenuItem>
            <MenuItem onClick={onTogglePin}>
              {session.pinnedAt ? (
                <>
                  <PinOff size={11} aria-hidden /> Unpin
                </>
              ) : (
                <>
                  <Pin size={11} aria-hidden /> Pin
                </>
              )}
            </MenuItem>
            <MenuItem onClick={onArchive}>
              {archivedView ? (
                <>
                  <Check size={11} aria-hidden /> Restore
                </>
              ) : (
                <>
                  <Archive size={11} aria-hidden /> Archive
                </>
              )}
            </MenuItem>
            <div className="chats-dropdown-menu-divider" aria-hidden />
            <MenuItem onClick={() => onExport('markdown')}>
              <FileText size={11} aria-hidden /> Export as Markdown
            </MenuItem>
            <MenuItem onClick={() => onExport('json')}>
              <FileJson size={11} aria-hidden /> Export as JSON
            </MenuItem>
            <div className="chats-dropdown-menu-divider" aria-hidden />
            <MenuItem onClick={onDelete} danger>
              <Trash2 size={11} aria-hidden /> Delete permanently
            </MenuItem>
          </div>
        )}
      </div>
    </div>
  )
}

function MenuItem({
  onClick,
  children,
  danger,
}: {
  onClick: () => void
  children: React.ReactNode
  danger?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`chats-dropdown-menu-item${danger ? ' is-danger' : ''}`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
