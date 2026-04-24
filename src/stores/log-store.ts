import { create } from 'zustand'
import { genShortId } from '../lib/id-gen'
import {
  truncate,
  type LogLevel,
  type LogSource,
  type LogType,
} from '../lib/log-classifier'

// Structured log entries. Each entry has a level (same axis as toast
// kinds), a source (which subsystem produced it — LLM, worker, library,
// etc.), a type (what kind of problem — runtime, network, permission,
// …), and an optional detail bag for anything serialisable (stacks,
// HTTP bodies, request params).
//
// Legacy callers of `push(level, message)` continue to work: the store
// fills source='ui', type='runtime'.

export interface LogDetail {
  stack?: string
  cause?: string
  httpStatus?: number
  httpBody?: string
  requestId?: string
  method?: string
  durationMs?: number
  code?: string
  traceback?: string
  componentStack?: string
  args?: unknown
  filename?: string
  lineno?: number
  _truncated?: boolean
  [k: string]: unknown
}

export interface LogEntry {
  id: string
  timestamp: number
  level: LogLevel
  source: LogSource
  type: LogType
  message: string
  detail?: LogDetail
}

export interface LogFilters {
  sources: Set<LogSource>
  types: Set<LogType>
  levels: Set<LogLevel>
  search: string
}

interface LogState {
  entries: LogEntry[]
  unreadCount: number
  open: boolean
  filters: LogFilters
  /** Richer API — preferred for new code. */
  pushEntry: (partial: {
    level: LogLevel
    source: LogSource
    type: LogType
    message: string
    detail?: LogDetail
  }) => string
  /** Legacy shim — used by the toast store's pre-meta callers. */
  push: (level: LogLevel, message: string) => string
  clear: () => void
  clearFiltered: () => void
  toggle: () => void
  setOpen: (v: boolean) => void
  markRead: () => void
  setFilters: (patch: Partial<LogFilters>) => void
  resetFilters: () => void
}

const MAX_ENTRIES = 500
const MAX_STACK = 8 * 1024
const MAX_BODY = 4 * 1024

const genId = () => genShortId('log', 6)

function emptyFilters(): LogFilters {
  return {
    sources: new Set(),
    types: new Set(),
    levels: new Set(),
    search: '',
  }
}

function sanitiseDetail(detail: LogDetail | undefined): LogDetail | undefined {
  if (!detail) return undefined
  let truncated = false
  const out: LogDetail = { ...detail }
  if (typeof out.stack === 'string' && out.stack.length > MAX_STACK) {
    out.stack = truncate(out.stack, MAX_STACK)
    truncated = true
  }
  if (typeof out.httpBody === 'string' && out.httpBody.length > MAX_BODY) {
    out.httpBody = truncate(out.httpBody, MAX_BODY)
    truncated = true
  }
  if (typeof out.traceback === 'string' && out.traceback.length > MAX_STACK) {
    out.traceback = truncate(out.traceback, MAX_STACK)
    truncated = true
  }
  if (truncated) out._truncated = true
  return out
}

export const useLogStore = create<LogState>((set, get) => ({
  entries: [],
  unreadCount: 0,
  open: false,
  filters: emptyFilters(),

  pushEntry: ({ level, source, type, message, detail }) => {
    const id = genId()
    const entry: LogEntry = {
      id,
      timestamp: Date.now(),
      level,
      source,
      type,
      message,
      detail: sanitiseDetail(detail),
    }
    set((s) => {
      const entries = [...s.entries, entry]
      if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES)
      return {
        entries,
        unreadCount: s.open ? s.unreadCount : s.unreadCount + 1,
      }
    })
    return id
  },

  push: (level, message) =>
    get().pushEntry({ level, source: 'ui', type: 'runtime', message }),

  clear: () => set({ entries: [], unreadCount: 0 }),

  clearFiltered: () => {
    const { entries, filters } = get()
    const remaining = entries.filter((e) => !matchesFilters(e, filters))
    set({ entries: remaining })
  },

  toggle: () =>
    set((s) => ({ open: !s.open, unreadCount: s.open ? s.unreadCount : 0 })),

  setOpen: (v) =>
    set((s) => ({ open: v, unreadCount: v ? 0 : s.unreadCount })),

  markRead: () => set({ unreadCount: 0 }),

  setFilters: (patch) =>
    set((s) => ({ filters: { ...s.filters, ...patch } })),

  resetFilters: () => set({ filters: emptyFilters() }),
}))

// ─── Pure helpers used by the UI ───────────────────────────────────

export function matchesFilters(entry: LogEntry, filters: LogFilters): boolean {
  if (filters.sources.size > 0 && !filters.sources.has(entry.source)) return false
  if (filters.types.size > 0 && !filters.types.has(entry.type)) return false
  if (filters.levels.size > 0 && !filters.levels.has(entry.level)) return false
  const q = filters.search.trim().toLowerCase()
  if (q) {
    const blob = `${entry.message} ${JSON.stringify(entry.detail ?? {})}`
      .toLowerCase()
    if (!blob.includes(q)) return false
  }
  return true
}

/** Stable JSON export — drops Set internals, keeps entry order. */
export function exportLogsAsJson(entries: LogEntry[]): string {
  return JSON.stringify(entries, null, 2)
}

// Re-export the taxonomies so importers can use one import path.
export type { LogLevel, LogSource, LogType } from '../lib/log-classifier'
export { LOG_LEVELS, LOG_SOURCES, LOG_TYPES } from '../lib/log-classifier'
