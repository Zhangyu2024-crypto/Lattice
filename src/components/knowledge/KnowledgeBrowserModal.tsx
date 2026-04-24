// KnowledgeBrowserModal — searchable browser over the lattice-cli
// knowledge database (paper extractions → knowledge chains → nodes).
//
// Layout mirrors the lattice-cli index.html knowledge view:
//
//   ┌──────────────┬───────────────────────────┬─────────────────────┐
//   │ Filters      │ Chain / extraction list   │ Detail pane         │
//   │ • search q   │ • one row per chain match │ • S→P→T→M flow      │
//   │ • material   │ • paper title + score     │ • nodes table       │
//   │ • metric     │                           │ • context excerpt   │
//   │ • technique  │                           │                     │
//   │ • min conf   │                           │                     │
//   │ Top tags     │                           │                     │
//   │ Stats card   │                           │                     │
//   └──────────────┴───────────────────────────┴─────────────────────┘

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Download,
  GitCompare,
  Loader2,
  Network,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from '../../stores/toast-store'
import { localProKnowledge } from '../../lib/local-pro-knowledge'
import { LEGACY_EXTRACTOR_VERSION } from '../../lib/knowledge/extractor-version'
import type {
  CompareMaterialsResponse,
  KnowledgeExtractionRow,
  KnowledgeProject,
  KnowledgeStats,
  KnowledgeTag,
  VariableListEntry,
} from '../../types/knowledge-api'

import KnowledgeCharts from './KnowledgeCharts'
import KnowledgeGraphPage from './KnowledgeGraphPage'
import ComparePane from './modal/ComparePane'
import DetailPane from './modal/DetailPane'
import FiltersPane from './modal/FiltersPane'
import ResultsPane from './modal/ResultsPane'
import {
  MAX_COMPARE_MATERIALS,
  MAX_COMPARE_METRICS,
} from './modal/types'
import { useKnowledgeSearch } from './useKnowledgeSearch'
import { useKnowledgeDetail } from './useKnowledgeDetail'

interface Props {
  open: boolean
  onClose: () => void
  onOpenMaterialComparison?: (payload: unknown, title: string) => void
  /**
   * `standalone` = dedicated BrowserWindow (`#/knowledge`). Material compare
   * forwards to the main workspace via IPC instead of `onOpenMaterialComparison`.
   */
  presentation?: 'modal' | 'standalone'
}

export default function KnowledgeBrowserModal({
  open,
  onClose,
  onOpenMaterialComparison,
  presentation = 'modal',
}: Props) {
  // Self-contained Port §P3 v3 — knowledge facade is `ready: false` until
  // the P4 Python worker lands; UI will render empty states.
  const api = localProKnowledge
  const search = useKnowledgeSearch({ api, open })
  const {
    filters,
    setFilters,
    resetFilters,
    results,
    mode,
    selected,
    setSelected,
    isSearching,
    errorMsg: searchErrorMsg,
  } = search
  const detail = useKnowledgeDetail({
    api,
    open,
    selectedId: selected?.extraction_id ?? null,
  })
  const [stats, setStats] = useState<KnowledgeStats | null>(null)
  const [tags, setTags] = useState<KnowledgeTag[]>([])
  const [recentExtractions, setRecentExtractions] = useState<
    KnowledgeExtractionRow[]
  >([])
  const [variableOptions, setVariableOptions] = useState<VariableListEntry[]>([])
  const [baseLoading, setBaseLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [baseErrorMsg, setBaseErrorMsg] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'chains' | 'graph' | 'charts'>('chains')
  const [compareOpen, setCompareOpen] = useState(false)
  const [selectedCompareMaterials, setSelectedCompareMaterials] = useState<
    string[]
  >([])
  const [selectedCompareMetrics, setSelectedCompareMetrics] = useState<string[]>(
    [],
  )
  // Independent of `busy` so a concurrent export/delete can't toggle the
  // Compare button back to idle while compareMaterials() is still in flight.
  const [compareBusy, setCompareBusy] = useState(false)
  const [projects, setProjects] = useState<KnowledgeProject[]>([])

  const canMaterialCompare = useMemo(
    () =>
      presentation === 'standalone'
        ? Boolean(window.electronAPI?.knowledgeSendMaterialComparisonToMain)
        : Boolean(onOpenMaterialComparison),
    [presentation, onOpenMaterialComparison],
  )
  // Request-id refs let async handlers detect that they've been superseded
  // (modal closed, or a newer request started) and skip writing stale state.
  const openRef = useRef(open)
  const selectedExtractionIdRef = useRef<number | null>(null)
  const loadBaseReqId = useRef(0)
  const compareReqId = useRef(0)
  const busyReqId = useRef(0)

  const loading = baseLoading || isSearching
  const errorMsg = baseErrorMsg ?? searchErrorMsg

  useEffect(() => {
    openRef.current = open
  }, [open])

  useEffect(() => {
    selectedExtractionIdRef.current = selected?.extraction_id ?? null
  }, [selected?.extraction_id])

  // ── Escape closes ──────────────────────────────────────────

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // ── Initial load (stats + tags + recent extractions) ─────────

  const loadBase = useCallback(async () => {
    if (!api.ready) return
    const reqId = ++loadBaseReqId.current
    setBaseLoading(true)
    setBaseErrorMsg(null)
    try {
      const [statsRes, tagsRes, extRes, varsRes, projectsRes] =
        await Promise.all([
          api.stats().catch(() => null),
          api.listTags().catch(() => [] as KnowledgeTag[]),
          api
            .listExtractions({ page: 1, limit: 20 })
            .catch(() => ({ extractions: [], total: 0 })),
          api
            .variableList()
            .catch(() => ({ variables: [] as VariableListEntry[] })),
          api.listProjects().catch(() => [] as KnowledgeProject[]),
        ])
      if (!openRef.current || reqId !== loadBaseReqId.current) return
      setStats(statsRes)
      setTags(tagsRes)
      setRecentExtractions(extRes.extractions)
      setVariableOptions(varsRes.variables ?? [])
      setProjects(projectsRes)
    } catch (err) {
      if (!openRef.current || reqId !== loadBaseReqId.current) return
      setBaseErrorMsg(err instanceof Error ? err.message : String(err))
    } finally {
      if (openRef.current && reqId === loadBaseReqId.current) {
        setBaseLoading(false)
      }
    }
  }, [api])

  useEffect(() => {
    if (!open) return
    void loadBase()
  }, [open, loadBase])

  // Reset on close. Bumping the request ids invalidates any in-flight
  // requests so their resolutions become no-ops. Cached collections (stats,
  // tags, etc.) are also dropped so a backend swap can't show stale data on
  // the next open — loadBase() repopulates within ~100 ms.
  useEffect(() => {
    if (open) return
    loadBaseReqId.current += 1
    compareReqId.current += 1
    busyReqId.current += 1
    search.reset()
    detail.reset()
    setStats(null)
    setTags([])
    setRecentExtractions([])
    setVariableOptions([])
    setProjects([])
    setBaseErrorMsg(null)
    setBaseLoading(false)
    setBusy(null)
    setViewMode('chains')
    setCompareOpen(false)
    setSelectedCompareMaterials([])
    setSelectedCompareMetrics([])
    setCompareBusy(false)
    // `search` / `detail` are captured by ref internally; reset() is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // ── Actions ──────────────────────────────────────────────────

  const run = useCallback(
    async <T,>(
      key: string,
      fn: () => Promise<T>,
      onSuccess: (r: T) => void,
    ) => {
      const reqId = ++busyReqId.current
      setBusy(key)
      try {
        const r = await fn()
        onSuccess(r)
      } catch (err) {
        toast.error(
          `${key}: ${err instanceof Error ? err.message : String(err)}`,
        )
      } finally {
        if (reqId === busyReqId.current) setBusy(null)
      }
    },
    [],
  )

  const handleExportCsv = () => {
    if (!api.ready) {
      toast.warn('Backend not ready')
      return
    }
    void run(
      'export-csv',
      () => api.exportCsv(),
      (text) => {
        const blob = new Blob([text], { type: 'text/csv' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'knowledge_chains.csv'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(url), 0)
        toast.success('Exported knowledge_chains.csv')
      },
    )
  }

  const handleClearLegacy = () => {
    // eslint-disable-next-line no-alert
    if (
      !window.confirm(
        'Purge all pre-v2 legacy chains? This permanently deletes chains written before the v2 quality gate landed. Accepted + diagnostic chains from v2 are not affected.',
      )
    ) {
      return
    }
    void run(
      'clear-legacy',
      () => api.clearChainsByVersion(LEGACY_EXTRACTOR_VERSION),
      (r) => {
        toast.success(
          `Cleared ${r.chainsRemoved} legacy chain${r.chainsRemoved === 1 ? '' : 's'}${
            r.extractionsPruned
              ? ` (${r.extractionsPruned} extraction${r.extractionsPruned === 1 ? '' : 's'} pruned)`
              : ''
          }`,
        )
        void loadBase()
        search.refetch()
      },
    )
  }

  const handleDeleteExtraction = (extractionId: number) => {
    // eslint-disable-next-line no-alert
    if (
      !window.confirm(
        `Delete extraction #${extractionId}? All chains will be removed.`,
      )
    )
      return
    void run(
      'delete-ext',
      () => api.deleteExtraction(extractionId),
      (r) => {
        if (r.success) {
          detail.invalidate(extractionId)
          if (selectedExtractionIdRef.current === extractionId) {
            setSelected((current) =>
              current?.extraction_id === extractionId ? null : current,
            )
          }
          toast.success('Extraction deleted')
          void loadBase()
          search.refetch()
        }
      },
    )
  }

  const handleAddTag = (extractionId: number, rawTag: string) => {
    const tag = rawTag.trim()
    if (!tag) return
    if (!api.ready) {
      toast.warn('Backend not ready')
      return
    }
    // Invalidate cache before refetch so the new tag is visible immediately
    // even if the server roundtrip completes after the refetch begins.
    void run(
      'add-tag',
      () => api.addTag(extractionId, { tag }),
      async (r) => {
        if (!r.success) {
          toast.error(`Add tag failed: ${r.error}`)
          return
        }
        detail.setTagDraft('')
        detail.invalidate(extractionId)
        if (
          openRef.current &&
          selectedExtractionIdRef.current === extractionId
        ) {
          await detail.reload(extractionId)
        }
        const tagsRes = await api.listTags().catch(() => null)
        if (!openRef.current) return
        if (tagsRes) setTags(tagsRes)
      },
    )
  }

  const handleRemoveTag = (extractionId: number, tag: string) => {
    if (!api.ready) {
      toast.warn('Backend not ready')
      return
    }
    void run(
      'remove-tag',
      () => api.removeTag(extractionId, tag),
      async (r) => {
        if (!r.success) {
          toast.error(`Remove tag failed: ${r.error ?? 'unknown error'}`)
          return
        }
        detail.invalidate(extractionId)
        if (
          openRef.current &&
          selectedExtractionIdRef.current === extractionId
        ) {
          await detail.reload(extractionId)
        }
        const tagsRes = await api.listTags().catch(() => null)
        if (!openRef.current) return
        if (tagsRes) setTags(tagsRes)
      },
    )
  }

  const handleToggleCompare = () => {
    if (!api.ready) {
      toast.warn('Backend not ready')
      return
    }
    setCompareOpen((v) => {
      const next = !v
      if (next) setViewMode('chains')
      return next
    })
  }

  const handleRunCompare = () => {
    if (selectedCompareMaterials.length === 0 || selectedCompareMetrics.length === 0) {
      toast.warn('Select at least one material and one metric')
      return
    }
    if (!canMaterialCompare) return
    const reqId = ++compareReqId.current
    setCompareBusy(true)
    void run(
      'compare',
      async () => {
        try {
          return await api.compareMaterials({
            materials: selectedCompareMaterials,
            metrics: selectedCompareMetrics,
          })
        } finally {
          if (reqId === compareReqId.current) setCompareBusy(false)
        }
      },
      (res) => {
        if (!openRef.current || reqId !== compareReqId.current) return
        const payload = adaptCompareResponseToArtifactPayload(res, variableOptions)
        if (payload.materials.length === 0 || payload.properties.length === 0) {
          toast.warn('Comparison returned no data')
          return
        }
        const title = `Comparison: ${payload.materials.length} materials × ${payload.properties.length} metrics`
        if (
          presentation === 'standalone' &&
          window.electronAPI?.knowledgeSendMaterialComparisonToMain
        ) {
          window.electronAPI.knowledgeSendMaterialComparisonToMain({
            title,
            artifactPayload: payload,
          })
          return
        }
        onOpenMaterialComparison?.(payload, title)
      },
    )
  }

  if (!open) return null

  // ── Render ────────────────────────────────────────────────────

  const isStandalone = presentation === 'standalone'

  return (
    <div
      onClick={isStandalone ? undefined : onClose}
      className={
        isStandalone
          ? 'knowledge-browser-standalone-root'
          : 'knowledge-browser-backdrop'
      }
    >
      <div
        onClick={isStandalone ? undefined : (e) => e.stopPropagation()}
        className={
          isStandalone
            ? 'knowledge-browser-panel knowledge-browser-panel--standalone'
            : 'knowledge-browser-panel'
        }
      >
        <div className="knowledge-browser-header">
          <div className="knowledge-browser-header-top">
            <Network
              size={18}
              strokeWidth={1.75}
              className="knowledge-browser-accent-icon"
              aria-hidden
            />
            <div className="knowledge-browser-header-titles">
              <strong className="knowledge-browser-title">Knowledge</strong>
              {stats ? (
                <span className="knowledge-browser-stats-badge">
                  {stats.total_extractions} extractions · {stats.total_chains}{' '}
                  chains · {stats.total_nodes} nodes
                </span>
              ) : null}
            </div>
            {loading ? (
              <Loader2
                size={14}
                className="spin knowledge-browser-muted-icon"
                aria-hidden
              />
            ) : null}
            <span className="knowledge-browser-header-spacer" />
            {!api.ready ? (
              <span
                className="knowledge-browser-offline-badge"
                title="Backend not connected"
              >
                Demo
              </span>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="knowledge-browser-icon-btn knowledge-browser-icon-btn--close"
              title="Close window (Esc)"
            >
              <X size={18} strokeWidth={1.75} />
            </button>
          </div>
          <div className="knowledge-browser-header-toolbar">
            <div
              className="satellite-view-toggle"
              role="group"
              aria-label="Main view"
            >
              <button
                type="button"
                className={viewMode === 'chains' ? 'is-active' : ''}
                onClick={() => {
                  setCompareOpen(false)
                  setViewMode('chains')
                }}
              >
                Chains
              </button>
              <button
                type="button"
                className={viewMode === 'charts' ? 'is-active' : ''}
                onClick={() => {
                  setCompareOpen(false)
                  setViewMode('charts')
                }}
              >
                Charts
              </button>
              <button
                type="button"
                className={viewMode === 'graph' ? 'is-active' : ''}
                onClick={() => {
                  setCompareOpen(false)
                  setViewMode('graph')
                }}
              >
                Graph
              </button>
            </div>
            <button
              type="button"
              onClick={handleToggleCompare}
              disabled={!api.ready || !canMaterialCompare}
              className={[
                'library-toolbar-btn',
                compareOpen ? 'is-active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              title={
                !api.ready
                  ? 'Connect backend to compare materials'
                  : !canMaterialCompare
                    ? 'Comparison viewer is unavailable in this context'
                    : 'Pick materials and metrics, then send comparison to workspace'
              }
            >
              <GitCompare size={14} strokeWidth={1.75} />
              <span>Compare</span>
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={!api.ready || busy === 'export-csv'}
              className="library-toolbar-btn"
              title={
                !api.ready
                  ? 'Connect backend to export chains'
                  : 'Export all chains as CSV'
              }
            >
              <Download size={14} strokeWidth={1.75} />
              <span>Export</span>
            </button>
            <button
              type="button"
              onClick={handleClearLegacy}
              disabled={!api.ready || busy === 'clear-legacy'}
              className="library-toolbar-btn"
              title="Permanently delete chains extracted before the v2 quality gate"
            >
              <Trash2 size={14} strokeWidth={1.75} />
              <span>Clear v1</span>
            </button>
          </div>
        </div>
        {errorMsg && (
          <div className="knowledge-browser-error-banner">
            Knowledge error: {errorMsg}
          </div>
        )}
        <div className="knowledge-browser-body">
          {viewMode === 'charts' ? (
            <KnowledgeCharts visible={true} />
          ) : viewMode === 'graph' ? (
            <KnowledgeGraphPage visible={true} />
          ) : (
            <>
              {compareOpen ? (
                <ComparePane
                  stats={stats}
                  variables={variableOptions}
                  selectedMaterials={selectedCompareMaterials}
                  onToggleMaterial={(name) =>
                    setSelectedCompareMaterials((prev) =>
                      toggleWithLimit(prev, name, MAX_COMPARE_MATERIALS),
                    )
                  }
                  selectedMetrics={selectedCompareMetrics}
                  onToggleMetric={(name) =>
                    setSelectedCompareMetrics((prev) =>
                      toggleWithLimit(prev, name, MAX_COMPARE_METRICS),
                    )
                  }
                  onReset={() => {
                    setSelectedCompareMaterials([])
                    setSelectedCompareMetrics([])
                  }}
                  onRun={handleRunCompare}
                  running={compareBusy}
                  ready={api.ready}
                />
              ) : (
                <FiltersPane
                  filters={filters}
                  onFiltersChange={setFilters}
                  tags={tags}
                  stats={stats}
                  recentExtractions={recentExtractions}
                  projects={projects}
                  onResetFilters={resetFilters}
                />
              )}
              <ResultsPane
                mode={mode}
                results={results}
                selected={selected}
                onSelect={setSelected}
                ready={api.ready}
                onDeleteExtraction={handleDeleteExtraction}
              />
              <DetailPane
                match={selected}
                detail={detail.detail}
                detailLoading={detail.loading}
                canEdit={api.ready}
                tagDraft={detail.tagDraft}
                onTagDraftChange={detail.setTagDraft}
                onAddTag={handleAddTag}
                onRemoveTag={handleRemoveTag}
                addBusy={busy === 'add-tag'}
                removeBusy={busy === 'remove-tag'}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────

function toggleWithLimit(list: string[], value: string, limit: number): string[] {
  if (list.includes(value)) return list.filter((x) => x !== value)
  if (list.length >= limit) return list
  return [...list, value]
}

function adaptCompareResponseToArtifactPayload(
  res: CompareMaterialsResponse,
  variables: VariableListEntry[],
): {
  materials: Array<{ id: string; name: string; formula: string }>
  properties: Array<{ key: string; label: string; unit?: string }>
  values: (number | null)[][]
} {
  const unitByName = new Map<string, string | undefined>()
  for (const v of variables) {
    if (v.unit && !unitByName.has(v.name)) unitByName.set(v.name, v.unit)
  }
  // Backend does not send formula; fall back to material name.
  const materials = (res.materials ?? []).map((name, i) => ({
    id: `${slugify(name) || 'mat'}-${i}`,
    name,
    formula: name,
  }))
  const properties = (res.metrics ?? []).map((name) => {
    const unit = inferUnit(res.data, res.metrics, name) ?? unitByName.get(name)
    return { key: name, label: name, ...(unit ? { unit } : {}) }
  })
  const rawRows = res.data ?? []
  const values: (number | null)[][] = materials.map((_, r) => {
    const row = rawRows[r] ?? []
    return properties.map((_, c) => {
      const cell = row[c]
      if (!cell) return null
      const v = cell.value
      if (typeof v === 'number' && Number.isFinite(v)) return v
      if (typeof v === 'string') {
        const parsed = Number.parseFloat(v)
        return Number.isFinite(parsed) ? parsed : null
      }
      return null
    })
  })
  return { materials, properties, values }
}

function inferUnit(
  data: CompareMaterialsResponse['data'],
  metrics: string[],
  metricName: string,
): string | undefined {
  const col = metrics.indexOf(metricName)
  if (col < 0) return undefined
  for (const row of data ?? []) {
    const cell = row?.[col]
    if (cell?.unit) return cell.unit
  }
  return undefined
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
