import { Search, BarChart3 } from 'lucide-react'
import { useDataIndexStore } from '@/stores/data-index-store'
import type { GroupBy, DataType } from '@/types/data-index'

const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'sample', label: 'Sample' },
  { value: 'technique', label: 'Technique' },
  { value: 'type', label: 'Type' },
  { value: 'tag', label: 'Tag' },
  { value: 'date', label: 'Date' },
  { value: 'folder', label: 'Folder' },
]

const TECHNIQUE_OPTIONS = ['All', 'XRD', 'XPS', 'Raman', 'FTIR', 'SEM', 'TEM', 'Other'] as const

const TYPE_OPTIONS: { value: '' | DataType; label: string }[] = [
  { value: '', label: 'All types' },
  { value: 'spectrum', label: 'Spectrum' },
  { value: 'analysis', label: 'Analysis' },
  { value: 'image', label: 'Image' },
  { value: 'paper', label: 'Paper' },
  { value: 'structure', label: 'Structure' },
  { value: 'compute', label: 'Compute' },
  { value: 'report', label: 'Report' },
]

const selectCss: React.CSSProperties = {
  background: '#2a2a2a',
  border: '1px solid #333',
  borderRadius: 4,
  color: '#ccc',
  fontSize: "var(--text-xs)",
  padding: '3px 6px',
  outline: 'none',
  cursor: 'pointer',
}

interface Props {
  statsExpanded: boolean
  onStatsToggle: () => void
}

export default function DataToolbar({ statsExpanded, onStatsToggle }: Props) {
  const searchQuery = useDataIndexStore((s) => s.searchQuery)
  const setSearchQuery = useDataIndexStore((s) => s.setSearchQuery)
  const groupBy = useDataIndexStore((s) => s.groupBy)
  const setGroupBy = useDataIndexStore((s) => s.setGroupBy)
  const filterTechnique = useDataIndexStore((s) => s.filterTechnique)
  const setFilterTechnique = useDataIndexStore((s) => s.setFilterTechnique)
  const filterDataType = useDataIndexStore((s) => s.filterDataType)
  const setFilterDataType = useDataIndexStore((s) => s.setFilterDataType)
  const allTags = useDataIndexStore((s) => s.index.tags)
  const filterTags = useDataIndexStore((s) => s.filterTags)
  const setFilterTags = useDataIndexStore((s) => s.setFilterTags)

  return (
    <div style={{ borderBottom: '1px solid #333', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px' }}>
        <Search size={14} strokeWidth={1.6} style={{ color: '#888', flexShrink: 0 }} />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search files, samples, tags..."
          style={{
            flex: 1,
            background: '#2a2a2a',
            border: '1px solid #333',
            borderRadius: 4,
            color: '#ccc',
            fontSize: "var(--text-sm)",
            padding: '4px 8px',
            outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={onStatsToggle}
          title={statsExpanded ? 'Hide statistics' : 'Show statistics'}
          style={{
            background: statsExpanded ? '#2a3a4a' : 'transparent',
            border: '1px solid #333',
            borderRadius: 4,
            color: statsExpanded ? '#60a5fa' : '#888',
            cursor: 'pointer',
            padding: '3px 6px',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <BarChart3 size={13} />
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '2px 10px 6px',
          fontSize: "var(--text-xs)",
          color: '#888',
          flexWrap: 'wrap',
        }}
      >
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span>Group:</span>
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
            style={selectCss}
          >
            {GROUP_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span>Tech:</span>
          <select
            value={filterTechnique ?? 'All'}
            onChange={(e) => setFilterTechnique(e.target.value === 'All' ? null : e.target.value)}
            style={selectCss}
          >
            {TECHNIQUE_OPTIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span>Type:</span>
          <select
            value={filterDataType ?? ''}
            onChange={(e) => setFilterDataType(e.target.value === '' ? null : e.target.value as DataType)}
            style={selectCss}
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>

        {allTags.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            <span>Tags:</span>
            {allTags.slice(0, 10).map((tag) => {
              const active = filterTags.includes(tag)
              return (
                <span
                  key={tag}
                  onClick={() => {
                    if (active) setFilterTags(filterTags.filter((t) => t !== tag))
                    else setFilterTags([...filterTags, tag])
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '1px 5px',
                    fontSize: "var(--text-xxs)",
                    borderRadius: 3,
                    background: active ? '#1a3a5c' : '#2a2a2a',
                    color: active ? '#58a6ff' : '#888',
                    border: `1px solid ${active ? '#2a4a6c' : '#333'}`,
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  {tag}
                </span>
              )
            })}
            {filterTags.length > 0 && (
              <span
                onClick={() => setFilterTags([])}
                style={{ fontSize: "var(--text-xxs)", color: '#666', cursor: 'pointer', textDecoration: 'underline' }}
              >
                clear
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
