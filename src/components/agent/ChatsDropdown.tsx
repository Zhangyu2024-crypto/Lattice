// Chats dropdown — replaces the "file-tree-as-chat-manager" UX with a
// purpose-built control panel hanging off ChatPanelHeader.
//
// Phase 1 scope: search + pin + list + switch + rename + soft-delete.
// Data lives in `runtime-store.sessions` (unchanged). Phase 2 swaps the
// storage for IndexedDB without touching this component — all reads go
// through the runtime-store selector so the refactor stays local.
//
// Row rendering and pure helpers live in `./chats-dropdown/` to keep
// this file focused on dropdown-level state (tabs, search, per-row
// menu open-id, rename draft, import wiring).

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { Plus, Search, Upload, X } from 'lucide-react'
import { useRuntimeStore } from '../../stores/runtime-store'
import type { Session, SessionId } from '../../types/session'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useOutsideClickDismiss } from '../../hooks/useOutsideClickDismiss'
import { exportSessionChat, type ExportFormat } from '../../lib/conversation-export'
import { importConversationFromText } from '../../lib/conversation-import'
import { toast } from '../../stores/toast-store'
import { ChatRow } from './chats-dropdown/ChatRow'
import { sessionMatchesQuery } from './chats-dropdown/helpers'
import { Section, TabButton } from './chats-dropdown/subparts'

interface Props {
  onClose: () => void
  /** Called when the user clicks "+ New chat". The parent owns the
   *  actual creation logic (existing ChatPanelHeader.onNewChat), so the
   *  dropdown stays renderer-agnostic about side effects. */
  onNewChat?: () => void
}

type Tab = 'active' | 'archived'

export default function ChatsDropdown({ onClose, onNewChat }: Props) {
  const sessions = useRuntimeStore((s) => s.sessions)
  const sessionOrder = useRuntimeStore((s) => s.sessionOrder)
  const activeSessionId = useRuntimeStore((s) => s.activeSessionId)
  const setActiveSession = useRuntimeStore((s) => s.setActiveSession)
  const renameSession = useRuntimeStore((s) => s.renameSession)
  const pinSession = useRuntimeStore((s) => s.pinSession)
  const setSessionArchived = useRuntimeStore((s) => s.setSessionArchived)
  const removeSession = useRuntimeStore((s) => s.removeSession)

  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<Tab>('active')
  const [menuOpenId, setMenuOpenId] = useState<SessionId | null>(null)
  const [renameId, setRenameId] = useState<SessionId | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  const rootRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  useEscapeKey(onClose)

  useEffect(() => {
    // Autofocus the search input on open so the user can start typing
    // immediately — matches ChatGPT / Linear quick-switcher feel.
    const t = window.setTimeout(() => searchRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [])

  useOutsideClickDismiss(rootRef, true, onClose)

  const now = Date.now()

  // Materialise Session records in the order runtime-store keeps them,
  // then split by tab / pinned / archived. We keep this pure-computed
  // so the dropdown re-renders cheaply on every store change (typing,
  // session flip, etc.).
  const { pinned, recent, archived } = useMemo(() => {
    const out: { pinned: Session[]; recent: Session[]; archived: Session[] } = {
      pinned: [],
      recent: [],
      archived: [],
    }
    const q = query.trim().toLowerCase()
    for (const id of sessionOrder) {
      const s = sessions[id]
      if (!s) continue
      if (q && !sessionMatchesQuery(s, q)) continue
      if (s.archivedAt) {
        out.archived.push(s)
      } else if (s.pinnedAt) {
        out.pinned.push(s)
      } else {
        out.recent.push(s)
      }
    }
    out.pinned.sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0))
    out.recent.sort((a, b) => b.updatedAt - a.updatedAt)
    out.archived.sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0))
    return out
  }, [sessions, sessionOrder, query])

  const normalizedQuery = query.trim().toLowerCase()

  const handleRowClick = useCallback(
    (id: SessionId) => {
      if (renameId === id) return // don't flip mid-rename
      setActiveSession(id)
      onClose()
    },
    [renameId, setActiveSession, onClose],
  )

  const startRename = useCallback(
    (ses: Session) => {
      setRenameId(ses.id)
      setRenameDraft(ses.title)
      setMenuOpenId(null)
    },
    [],
  )

  const commitRename = useCallback(() => {
    if (!renameId) return
    const title = renameDraft.trim()
    if (title.length > 0) renameSession(renameId, title)
    setRenameId(null)
    setRenameDraft('')
  }, [renameId, renameDraft, renameSession])

  const cancelRename = useCallback(() => {
    setRenameId(null)
    setRenameDraft('')
  }, [])

  const handleExport = useCallback(
    (ses: Session, format: ExportFormat) => {
      exportSessionChat(ses, format)
      setMenuOpenId(null)
    },
    [],
  )

  const handleDelete = useCallback(
    (ses: Session) => {
      setMenuOpenId(null)
      const label = ses.title || 'Untitled'
      // Hard delete — second gate beyond Archive. Native confirm keeps the
      // interaction honest without pulling in a modal just for this.
      const ok = window.confirm(
        `Permanently delete "${label}"?\n\nThis removes the chat and its transcript. This cannot be undone.`,
      )
      if (!ok) return
      removeSession(ses.id)
    },
    [removeSession],
  )

  const importInputRef = useRef<HTMLInputElement | null>(null)
  const handleImportClick = useCallback(() => {
    importInputRef.current?.click()
  }, [])
  const handleImportChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      // Reset so the same file can be re-imported in a follow-up attempt.
      e.target.value = ''
      if (!file) return
      try {
        const text = await file.text()
        const res = importConversationFromText(text)
        if (res.ok) {
          toast.success(
            `Imported "${res.title}" (${res.messageCount} message${res.messageCount === 1 ? '' : 's'}).`,
          )
          onClose()
        } else {
          toast.error(`Import failed: ${res.error}`)
        }
      } catch (err) {
        toast.error(
          `Import failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    },
    [onClose],
  )

  const handleRenameKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitRename()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelRename()
    }
  }

  const showingList =
    tab === 'active'
      ? { pinned, recent, archived: [] as Session[] }
      : { pinned: [] as Session[], recent: [] as Session[], archived }

  // All three list sections (pinned / recent / archived) render
  // `ChatRow` with the same handler wiring; only `archivedView` and
  // the archive-toggle target flip. A single `renderRow` keeps the
  // JSX below flat and guarantees the three sections stay in sync.
  const renderRow = (s: Session, opts: { archivedView?: boolean } = {}) => (
    <ChatRow
      key={s.id}
      session={s}
      active={s.id === activeSessionId}
      now={now}
      renaming={renameId === s.id}
      renameDraft={renameDraft}
      menuOpen={menuOpenId === s.id}
      archivedView={opts.archivedView}
      query={normalizedQuery}
      onClick={() => handleRowClick(s.id)}
      onRenameDraftChange={setRenameDraft}
      onCommitRename={commitRename}
      onCancelRename={cancelRename}
      onRenameKey={handleRenameKey}
      onToggleMenu={() =>
        setMenuOpenId((v) => (v === s.id ? null : s.id))
      }
      onStartRename={() => startRename(s)}
      onTogglePin={() => {
        pinSession(s.id, !s.pinnedAt)
        setMenuOpenId(null)
      }}
      onArchive={() => {
        // In the archived view, the "archive" action restores (un-archives);
        // elsewhere it archives. Matches the pre-split behaviour.
        setSessionArchived(s.id, !opts.archivedView)
        setMenuOpenId(null)
      }}
      onExport={(fmt) => handleExport(s, fmt)}
      onDelete={() => handleDelete(s)}
    />
  )

  return (
    <div
      ref={rootRef}
      className="chats-dropdown"
      role="dialog"
      aria-label="Chats"
    >
      <div className="chats-dropdown-search-row">
        <Search
          size={12}
          strokeWidth={1.8}
          aria-hidden
          className="chats-dropdown-search-icon"
        />
        <input
          ref={searchRef}
          type="text"
          className="chats-dropdown-search"
          placeholder="Search chats…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
        />
        {query.length > 0 && (
          <button
            type="button"
            className="chats-dropdown-clear-btn"
            onClick={() => setQuery('')}
            aria-label="Clear search"
            title="Clear"
          >
            <X size={11} aria-hidden />
          </button>
        )}
      </div>

      <div className="chats-dropdown-action-row">
        {onNewChat && (
          <button
            type="button"
            className="chats-dropdown-new-btn"
            onClick={() => {
              onNewChat()
              onClose()
            }}
          >
            <Plus size={11} strokeWidth={1.8} aria-hidden />
            New chat
          </button>
        )}
        <button
          type="button"
          className="chats-dropdown-import-btn"
          onClick={handleImportClick}
          title="Import a .chat.json or exported session"
        >
          <Upload size={11} strokeWidth={1.8} aria-hidden />
          Import
        </button>
        <input
          ref={importInputRef}
          type="file"
          accept=".json,.chat.json,application/json"
          style={{ display: 'none' }}
          onChange={handleImportChange}
        />
      </div>

      <div className="chats-dropdown-tabs">
        <TabButton
          active={tab === 'active'}
          onClick={() => setTab('active')}
          count={pinned.length + recent.length}
        >
          Active
        </TabButton>
        <TabButton
          active={tab === 'archived'}
          onClick={() => setTab('archived')}
          count={archived.length}
        >
          Archived
        </TabButton>
      </div>

      <div className="chats-dropdown-list">
        {tab === 'active' && showingList.pinned.length > 0 && (
          <Section title="Pinned">
            {showingList.pinned.map((s) => renderRow(s))}
          </Section>
        )}

        {tab === 'active' && (
          <Section title={showingList.pinned.length > 0 ? 'Recent' : undefined}>
            {showingList.recent.length === 0 ? (
              <div className="chats-dropdown-empty">
                {query ? 'No chats match.' : 'No chats yet.'}
              </div>
            ) : (
              showingList.recent.map((s) => renderRow(s))
            )}
          </Section>
        )}

        {tab === 'archived' && (
          <Section>
            {showingList.archived.length === 0 ? (
              <div className="chats-dropdown-empty">
                {query ? 'No archived chats match.' : 'No archived chats.'}
              </div>
            ) : (
              showingList.archived.map((s) => renderRow(s, { archivedView: true }))
            )}
          </Section>
        )}
      </div>
    </div>
  )
}

