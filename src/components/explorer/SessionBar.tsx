// Compact session picker + summary strip that sits above the file tree
// in ExplorerView. Replaces the deleted SessionView's session management
// with a minimal, always-visible bar.

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  MoreHorizontal,
  Plus,
} from 'lucide-react'
import {
  selectActiveSession,
  useRuntimeStore,
} from '../../stores/runtime-store'
import { useShallow } from 'zustand/react/shallow'
import { asyncPrompt } from '../../lib/prompt-dialog'

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export default function SessionBar() {
  const session = useRuntimeStore(selectActiveSession)
  const sessionOrder = useRuntimeStore(useShallow((s) => s.sessionOrder))
  const sessions = useRuntimeStore(useShallow((s) => s.sessions))
  const activeSessionId = useRuntimeStore((s) => s.activeSessionId)
  const createSession = useRuntimeStore((s) => s.createSession)
  const setActiveSession = useRuntimeStore((s) => s.setActiveSession)
  const renameSession = useRuntimeStore((s) => s.renameSession)
  const removeSession = useRuntimeStore((s) => s.removeSession)

  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLDivElement>(null)

  const handleNew = useCallback(() => {
    const id = createSession({
      title: `Session ${sessionOrder.length + 1}`,
    })
    setActiveSession(id)
    setDropdownOpen(false)
  }, [createSession, setActiveSession, sessionOrder.length])

  const handleRename = useCallback(async () => {
    if (!activeSessionId || !session) return
    const next = await asyncPrompt('Rename session', session.title)
    if (next && next.trim()) renameSession(activeSessionId, next.trim())
    setMoreOpen(false)
  }, [activeSessionId, session, renameSession])

  const handleDelete = useCallback(() => {
    if (!activeSessionId || sessionOrder.length <= 1) return
    const ok = window.confirm(`Delete session "${session?.title}"?`)
    if (!ok) return
    removeSession(activeSessionId)
    setMoreOpen(false)
  }, [activeSessionId, session, sessionOrder.length, removeSession])

  const summary = useMemo(() => {
    if (!session) return ''
    const arts = Object.keys(session.artifacts).length
    const msgs = session.transcript.length
    const time = session.updatedAt ? relativeTime(session.updatedAt) : ''
    const parts: string[] = []
    if (arts > 0) parts.push(`${arts} artifact${arts === 1 ? '' : 's'}`)
    if (msgs > 0) parts.push(`${msgs} msg${msgs === 1 ? '' : 's'}`)
    if (time) parts.push(time)
    return parts.join(' · ') || 'empty session'
  }, [session])

  return (
    <div className="session-bar">
      <div className="session-bar-row">
        <div className="session-bar-picker" ref={dropdownRef}>
          <button
            type="button"
            className="session-bar-current"
            onClick={() => setDropdownOpen((v) => !v)}
            title={session?.title ?? 'No session'}
          >
            <span className="session-bar-title">
              {session?.title ?? 'No session'}
            </span>
            <ChevronDown
              size={13}
              className={`session-bar-chevron${dropdownOpen ? ' is-open' : ''}`}
            />
          </button>
          {dropdownOpen && (
            <div className="session-bar-dropdown">
              {sessionOrder.map((id) => {
                const s = sessions[id]
                if (!s) return null
                return (
                  <button
                    key={id}
                    type="button"
                    className={`session-bar-dropdown-item${
                      id === activeSessionId ? ' is-active' : ''
                    }`}
                    onClick={() => {
                      setActiveSession(id)
                      setDropdownOpen(false)
                    }}
                  >
                    {s.title}
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <button
          type="button"
          className="session-bar-icon-btn"
          onClick={handleNew}
          title="New session"
          aria-label="New session"
        >
          <Plus size={14} />
        </button>
        <div className="session-bar-more-wrap" ref={moreRef}>
          <button
            type="button"
            className="session-bar-icon-btn"
            onClick={() => setMoreOpen((v) => !v)}
            title="Session actions"
            aria-label="Session actions"
          >
            <MoreHorizontal size={14} />
          </button>
          {moreOpen && (
            <div className="session-bar-dropdown session-bar-dropdown--right">
              <button
                type="button"
                className="session-bar-dropdown-item"
                onClick={handleRename}
              >
                Rename
              </button>
              <button
                type="button"
                className="session-bar-dropdown-item is-danger"
                onClick={handleDelete}
                disabled={sessionOrder.length <= 1}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
      {summary && (
        <div className="session-bar-summary">{summary}</div>
      )}
    </div>
  )
}
