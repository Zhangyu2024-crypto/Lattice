import { useEffect, useMemo, useRef, useState } from 'react'
import '../../styles/log-console.css'
import { ClipboardCopy, Filter, Trash2, X } from 'lucide-react'
import {
  exportLogsAsJson,
  matchesFilters,
  useLogStore,
} from '../../stores/log-store'
import { toast } from '../../stores/toast-store'
import LogFilterBar from './LogFilterBar'
import LogRow from './LogRow'

export default function LogConsole() {
  const entries = useLogStore((s) => s.entries)
  const open = useLogStore((s) => s.open)
  const filters = useLogStore((s) => s.filters)
  const setOpen = useLogStore((s) => s.setOpen)
  const clear = useLogStore((s) => s.clear)
  const clearFiltered = useLogStore((s) => s.clearFiltered)

  const [filtersOpen, setFiltersOpen] = useState(true)
  const listRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)

  const filtered = useMemo(
    () => entries.filter((e) => matchesFilters(e, filters)),
    [entries, filters],
  )

  // Auto-scroll only when already pinned to bottom — new entries should
  // not yank the view away from something the user is inspecting.
  useEffect(() => {
    if (!open) return
    const el = listRef.current
    if (!el) return
    if (atBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [open, filtered.length])

  const onScroll = () => {
    const el = listRef.current
    if (!el) return
    const slack = 24
    atBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <= slack
  }

  // Keyboard: `/` focuses search, `Esc` closes the console.
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
      } else if (
        e.key === '/' &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault()
        const el = document.querySelector<HTMLInputElement>(
          '.log-filter-search-input',
        )
        el?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, setOpen])

  if (!open) return null

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(exportLogsAsJson(filtered))
      toast.success(
        `Copied ${filtered.length} log ${filtered.length === 1 ? 'entry' : 'entries'}`,
        { skipLog: true },
      )
    } catch {
      toast.error('Copy failed', { skipLog: true })
    }
  }

  const totalBadge = `${filtered.length}${
    filtered.length !== entries.length ? `/${entries.length}` : ''
  }`

  return (
    <div className="log-console">
      <div className="log-console-header">
        <span className="log-console-title">Log</span>
        <span className="log-console-count">{totalBadge}</span>
        <span style={{ flex: 1 }} />
        <button
          className={`log-console-action${filtersOpen ? ' is-active' : ''}`}
          onClick={() => setFiltersOpen((v) => !v)}
          title={filtersOpen ? 'Hide filters' : 'Show filters'}
        >
          <Filter size={13} />
        </button>
        <button
          className="log-console-action"
          onClick={copyJson}
          title={`Copy ${filtered.length} entries as JSON`}
          disabled={filtered.length === 0}
        >
          <ClipboardCopy size={13} />
        </button>
        <button
          className="log-console-action"
          onClick={clearFiltered}
          title="Clear filtered entries"
          disabled={filtered.length === 0}
        >
          <Trash2 size={13} />
        </button>
        <button
          className="log-console-action"
          onClick={clear}
          title="Clear all entries"
          disabled={entries.length === 0}
        >
          <Trash2 size={13} opacity={0.6} />
        </button>
        <button
          className="log-console-action"
          onClick={() => setOpen(false)}
          title="Close (Esc)"
        >
          <X size={13} />
        </button>
      </div>

      {filtersOpen && <LogFilterBar entries={entries} />}

      <div className="log-console-body" ref={listRef} onScroll={onScroll}>
        {entries.length === 0 ? (
          <div className="log-console-empty">No log entries yet</div>
        ) : filtered.length === 0 ? (
          <div className="log-console-empty">
            No entries match the current filter
          </div>
        ) : (
          filtered.map((e) => <LogRow key={e.id} entry={e} />)
        )}
      </div>
    </div>
  )
}
