// Left pane: filter inputs, tag cloud, projects, stats, recent extractions.
// Extracted verbatim from ../KnowledgeBrowserModal.tsx — pure, controlled by
// props only.

import {
  Activity,
  FileText,
  Filter,
  FolderKanban,
  Search,
  Tag,
  X,
} from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'

import type {
  KnowledgeExtractionRow,
  KnowledgeProject,
  KnowledgeStats,
  KnowledgeTag,
} from '../../../types/knowledge-api'
import { truncate, type FilterState } from './types'

export default function FiltersPane({
  filters,
  onFiltersChange,
  tags,
  stats,
  recentExtractions,
  projects,
  onResetFilters,
}: {
  filters: FilterState
  onFiltersChange: (next: FilterState) => void
  tags: KnowledgeTag[]
  stats: KnowledgeStats | null
  recentExtractions: KnowledgeExtractionRow[]
  projects: KnowledgeProject[]
  onResetFilters: () => void
}) {
  const set = (patch: Partial<FilterState>) =>
    onFiltersChange({ ...filters, ...patch })
  const anyActive =
    filters.q ||
    filters.material ||
    filters.metric ||
    filters.technique ||
    filters.tag ||
    filters.min_confidence > 0
  return (
    <div className="knowledge-browser-left-pane">
      <div className="knowledge-browser-pane-header">
        <span className="knowledge-browser-pane-label">
          <Filter size={10} className="knowledge-browser-inline-icon" />
          Filters
        </span>
        {anyActive && (
          <button
            onClick={onResetFilters}
            className="knowledge-browser-icon-btn"
            title="Clear"
          >
            <X size={12} />
          </button>
        )}
      </div>

      <FilterInput
        label="Search"
        icon={<Search size={11} />}
        value={filters.q}
        onChange={(v) => set({ q: v })}
        placeholder="full-text query…"
      />
      <FilterInput
        label="Material"
        value={filters.material}
        onChange={(v) => set({ material: v })}
        placeholder="e.g. BaTiO3"
      />
      <FilterInput
        label="Metric"
        value={filters.metric}
        onChange={(v) => set({ metric: v })}
        placeholder="e.g. band_gap"
      />
      <FilterInput
        label="Technique"
        value={filters.technique}
        onChange={(v) => set({ technique: v })}
        placeholder="e.g. XRD"
      />

      <div className="knowledge-browser-row-group">
        <span className="knowledge-browser-row-label">Min conf</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={filters.min_confidence}
          onChange={(e) =>
            set({ min_confidence: Number(e.target.value) })
          }
          className="knowledge-browser-row-slider"
        />
        <span className="knowledge-browser-row-value">
          {filters.min_confidence.toFixed(2)}
        </span>
      </div>

      {tags.length > 0 && (
        <div className="knowledge-browser-section">
          <div className="knowledge-browser-section-label">
            <Tag size={10} /> Tags
          </div>
          <div className="knowledge-browser-tag-cloud">
            {tags.slice(0, 16).map((t) => {
              const active = filters.tag === t.tag
              return (
                <button
                  key={t.tag}
                  onClick={() =>
                    set({ tag: active ? '' : t.tag })
                  }
                  className={[
                    'knowledge-browser-tag-pill',
                    active ? 'is-active' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {t.tag}
                  <span className="knowledge-browser-tag-count">
                    {t.count}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {projects.length > 0 && (
        <div className="knowledge-browser-section">
          <div className="knowledge-browser-section-label">
            <FolderKanban size={10} /> Projects
            <span
              className="knowledge-browser-project-hint"
              title="Read-only: search does not yet filter by project."
            >
              info
            </span>
          </div>
          <div className="knowledge-browser-mini-list">
            {projects.slice(0, 12).map((p) => {
              const dotStyle: CSSProperties & Record<string, string> = {
                '--proj-color': p.color ?? 'transparent',
              }
              return (
                <div
                  key={p.id}
                  className="knowledge-browser-mini-row knowledge-browser-mini-row--static"
                  title={
                    p.description
                      ? `${p.description}${
                          p.keywords?.length
                            ? ` — ${p.keywords.join(', ')}`
                            : ''
                        }`
                      : p.keywords?.join(', ') || p.name
                  }
                >
                  {p.color && (
                    <span
                      className="knowledge-browser-project-dot"
                      style={dotStyle}
                    />
                  )}
                  <span className="knowledge-browser-mini-name">{p.name}</span>
                  {typeof p.extraction_count === 'number' && (
                    <span className="knowledge-browser-mini-count">
                      {p.extraction_count}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {stats && (
        <div className="knowledge-browser-section">
          <div className="knowledge-browser-section-label">
            <Activity size={10} /> Top materials
          </div>
          <div className="knowledge-browser-mini-list">
            {stats.top_materials.slice(0, 8).map((m) => (
              <button
                key={m.name}
                onClick={() => set({ material: m.name })}
                className="knowledge-browser-mini-row"
              >
                <span className="knowledge-browser-mini-name">{m.name}</span>
                <span className="knowledge-browser-mini-count">
                  {m.count}
                </span>
              </button>
            ))}
          </div>
          <div className="knowledge-browser-section-label knowledge-browser-section-label--spaced">
            <Activity size={10} /> Top metrics
          </div>
          <div className="knowledge-browser-mini-list">
            {stats.top_metrics.slice(0, 8).map((m) => (
              <button
                key={m.name}
                onClick={() => set({ metric: m.name })}
                className="knowledge-browser-mini-row"
              >
                <span className="knowledge-browser-mini-name">{m.name}</span>
                <span className="knowledge-browser-mini-count">
                  {m.count}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {recentExtractions.length > 0 && (
        <div className="knowledge-browser-section">
          <div className="knowledge-browser-section-label">
            <FileText size={10} /> Recent extractions
          </div>
          <div className="knowledge-browser-mini-list">
            {recentExtractions.slice(0, 6).map((e) => (
              <div
                key={e.id}
                className="knowledge-browser-mini-row knowledge-browser-mini-row--static"
                title={e.title}
              >
                <span className="knowledge-browser-mini-name">
                  {truncate(e.title, 30)}
                </span>
                <span className="knowledge-browser-mini-count">
                  {e.chain_count ?? 0}c
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function FilterInput({
  label,
  icon,
  value,
  onChange,
  placeholder,
}: {
  label: string
  icon?: ReactNode
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="knowledge-browser-filter-label">
      <span className="knowledge-browser-filter-key">
        {icon}
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="knowledge-browser-filter-input"
      />
    </label>
  )
}
