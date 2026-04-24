// Left pane (compare mode): picker for materials × metrics to run a
// CompareMaterials request. Extracted verbatim from
// ../KnowledgeBrowserModal.tsx.

import { useMemo } from 'react'
import { Activity, GitCompare, Loader2, X } from 'lucide-react'

import type {
  KnowledgeStats,
  VariableListEntry,
} from '../../../types/knowledge-api'
import { MAX_COMPARE_MATERIALS, MAX_COMPARE_METRICS } from './types'

export default function ComparePane({
  stats,
  variables,
  selectedMaterials,
  onToggleMaterial,
  selectedMetrics,
  onToggleMetric,
  onReset,
  onRun,
  running,
  ready,
}: {
  stats: KnowledgeStats | null
  variables: VariableListEntry[]
  selectedMaterials: string[]
  onToggleMaterial: (name: string) => void
  selectedMetrics: string[]
  onToggleMetric: (name: string) => void
  onReset: () => void
  onRun: () => void
  running: boolean
  ready: boolean
}) {
  const materialOptions = useMemo<Array<{ name: string; count: number }>>(() => {
    const rows = stats?.top_materials ?? []
    return rows.slice(0, 16)
  }, [stats])

  const metricOptions = useMemo<Array<{ name: string; unit?: string; count?: number }>>(() => {
    const seen = new Map<string, { name: string; unit?: string; count?: number }>()
    for (const m of stats?.top_metrics ?? []) {
      if (!seen.has(m.name)) seen.set(m.name, { name: m.name, count: m.count })
    }
    for (const v of variables) {
      // variable-list may include non-metric roles; keep any un-seen name so
      // the picker still offers them as candidate comparison metrics.
      if (!seen.has(v.name)) seen.set(v.name, { name: v.name, unit: v.unit, count: v.count })
      else if (v.unit && !seen.get(v.name)!.unit) {
        seen.get(v.name)!.unit = v.unit
      }
    }
    return Array.from(seen.values()).slice(0, 24)
  }, [stats, variables])

  const anySelected = selectedMaterials.length > 0 || selectedMetrics.length > 0
  const canRun =
    ready &&
    !running &&
    selectedMaterials.length > 0 &&
    selectedMetrics.length > 0

  return (
    <div className="knowledge-browser-left-pane">
      <div className="knowledge-browser-pane-header">
        <span className="knowledge-browser-pane-label">
          <GitCompare
            size={10}
            className="knowledge-browser-inline-icon"
          />
          Compare
        </span>
        {anySelected && (
          <button
            onClick={onReset}
            className="knowledge-browser-icon-btn"
            title="Clear selection"
          >
            <X size={12} />
          </button>
        )}
      </div>
      <div className="knowledge-browser-compare-hint">
        Select up to {MAX_COMPARE_MATERIALS} materials and{' '}
        {MAX_COMPARE_METRICS} metrics.
      </div>

      <div className="knowledge-browser-section-label">
        <Activity size={10} /> Materials ({selectedMaterials.length}/
        {MAX_COMPARE_MATERIALS})
      </div>
      {materialOptions.length === 0 ? (
        <div className="knowledge-browser-compare-empty">
          No material stats available.
        </div>
      ) : (
        <div className="knowledge-browser-compare-list">
          {materialOptions.map((m) => {
            const checked = selectedMaterials.includes(m.name)
            const disabled =
              !checked && selectedMaterials.length >= MAX_COMPARE_MATERIALS
            return (
              <CompareRow
                key={m.name}
                name={m.name}
                checked={checked}
                disabled={disabled}
                onChange={() => onToggleMaterial(m.name)}
                rightText={String(m.count)}
              />
            )
          })}
        </div>
      )}

      <div className="knowledge-browser-section-label knowledge-browser-section-label--spaced">
        <Activity size={10} /> Metrics ({selectedMetrics.length}/
        {MAX_COMPARE_METRICS})
      </div>
      {metricOptions.length === 0 ? (
        <div className="knowledge-browser-compare-empty">
          No metric stats available.
        </div>
      ) : (
        <div className="knowledge-browser-compare-list">
          {metricOptions.map((m) => {
            const checked = selectedMetrics.includes(m.name)
            const disabled =
              !checked && selectedMetrics.length >= MAX_COMPARE_METRICS
            const right =
              m.unit ?? (typeof m.count === 'number' ? String(m.count) : '')
            return (
              <CompareRow
                key={m.name}
                name={m.name}
                checked={checked}
                disabled={disabled}
                onChange={() => onToggleMetric(m.name)}
                rightText={right}
              />
            )
          })}
        </div>
      )}

      <button
        type="button"
        onClick={onRun}
        disabled={!canRun}
        className={[
          'knowledge-browser-compare-run-btn',
          canRun ? '' : 'is-disabled',
        ]
          .filter(Boolean)
          .join(' ')}
        title="Run comparison"
      >
        {running ? (
          <Loader2 size={12} className="spin" />
        ) : (
          <GitCompare size={12} />
        )}
        Run Comparison
      </button>
    </div>
  )
}

function CompareRow({
  name,
  checked,
  disabled,
  onChange,
  rightText,
}: {
  name: string
  checked: boolean
  disabled: boolean
  onChange: () => void
  rightText: string
}) {
  return (
    <label
      className={[
        'knowledge-browser-compare-row',
        checked ? 'is-selected' : '',
        disabled ? 'is-disabled' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="knowledge-browser-compare-checkbox"
      />
      <span className="knowledge-browser-compare-row-name">{name}</span>
      {rightText && (
        <span className="knowledge-browser-compare-row-count">
          {rightText}
        </span>
      )}
    </label>
  )
}
