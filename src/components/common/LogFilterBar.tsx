// LogFilterBar — multi-select pill rows + search input for LogConsole.
//
// Sources and types are derived from the current log entries so the
// picker only shows buckets that have actually appeared. Levels are a
// fixed four-way toggle. Clicking a pill toggles inclusion.

import { useMemo } from 'react'
import { Search, X } from 'lucide-react'
import {
  useLogStore,
  type LogEntry,
} from '../../stores/log-store'
import {
  LOG_LEVELS,
  type LogLevel,
  type LogSource,
  type LogType,
} from '../../lib/log-classifier'

interface Props {
  entries: LogEntry[]
}

export default function LogFilterBar({ entries }: Props) {
  const filters = useLogStore((s) => s.filters)
  const setFilters = useLogStore((s) => s.setFilters)
  const resetFilters = useLogStore((s) => s.resetFilters)

  // Available sources/types are derived — only show buckets that exist
  // so the picker doesn't clutter with unused taxonomies.
  const availableSources = useMemo(() => {
    const set = new Set<LogSource>()
    for (const e of entries) set.add(e.source)
    return [...set].sort()
  }, [entries])

  const availableTypes = useMemo(() => {
    const set = new Set<LogType>()
    for (const e of entries) set.add(e.type)
    return [...set].sort()
  }, [entries])

  const toggleSource = (s: LogSource) => {
    const next = new Set(filters.sources)
    next.has(s) ? next.delete(s) : next.add(s)
    setFilters({ sources: next })
  }
  const toggleType = (t: LogType) => {
    const next = new Set(filters.types)
    next.has(t) ? next.delete(t) : next.add(t)
    setFilters({ types: next })
  }
  const toggleLevel = (l: LogLevel) => {
    const next = new Set(filters.levels)
    next.has(l) ? next.delete(l) : next.add(l)
    setFilters({ levels: next })
  }

  const hasActiveFilter =
    filters.sources.size > 0 ||
    filters.types.size > 0 ||
    filters.levels.size > 0 ||
    filters.search.trim().length > 0

  return (
    <div className="log-filter-bar">
      <div className="log-filter-row">
        <span className="log-filter-label">Level</span>
        <div className="log-filter-pills">
          {LOG_LEVELS.map((l) => (
            <button
              key={l}
              type="button"
              className={`log-filter-pill log-filter-pill--level log-filter-pill--${l}${
                filters.levels.has(l) ? ' is-active' : ''
              }`}
              onClick={() => toggleLevel(l)}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {availableSources.length > 0 && (
        <div className="log-filter-row">
          <span className="log-filter-label">Source</span>
          <div className="log-filter-pills">
            {availableSources.map((s) => (
              <button
                key={s}
                type="button"
                className={`log-filter-pill${
                  filters.sources.has(s) ? ' is-active' : ''
                }`}
                onClick={() => toggleSource(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {availableTypes.length > 0 && (
        <div className="log-filter-row">
          <span className="log-filter-label">Type</span>
          <div className="log-filter-pills">
            {availableTypes.map((t) => (
              <button
                key={t}
                type="button"
                className={`log-filter-pill${
                  filters.types.has(t) ? ' is-active' : ''
                }`}
                onClick={() => toggleType(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="log-filter-search">
        <Search size={12} className="log-filter-search-icon" aria-hidden />
        <input
          type="text"
          value={filters.search}
          onChange={(e) => setFilters({ search: e.target.value })}
          placeholder="Search message or detail…"
          className="log-filter-search-input"
        />
        {hasActiveFilter && (
          <button
            type="button"
            className="log-filter-clear"
            onClick={resetFilters}
            title="Clear filters"
          >
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  )
}
