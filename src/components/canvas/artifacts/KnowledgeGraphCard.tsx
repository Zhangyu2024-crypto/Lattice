import { useCallback, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { Circle, Network, Search, X } from 'lucide-react'
import { buildLocalPaperArtifact } from '../../../lib/local-artifact-builders'
import type { Artifact } from '../../../types/artifact'
import { CHART_PRIMARY, CHART_SERIES_PALETTE } from '../../../lib/chart-colors'
import { CHART_TEXT_PX } from '../../../lib/chart-text-px'
import { Badge, Button, IconButton } from '../../ui'

type NodeCategory = 'material' | 'process' | 'property' | 'paper' | 'element'

interface KnowledgeNode {
  id: string; label: string; category: NodeCategory
  symbolSize?: number; value?: number; paperRef?: string
}

interface KnowledgeEdge {
  source: string; target: string; relation: string; weight?: number
}

interface KnowledgeGraphPayload {
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
  stats: { nodeCount: number; edgeCount: number; categoryCounts: Record<NodeCategory, number> }
  query?: string
}

interface Props {
  artifact: Artifact
  /** Host materialises the derived paper-note artifact (upsert + focus). */
  onOpenDerivedArtifact?: (next: Artifact) => void
  /** Warn when a clicked node has no paperRef attached. */
  onMissingPaperRef?: (label: string) => void
  className?: string
}

const CATEGORY_COLORS: Record<NodeCategory, string> = {
  material: CHART_SERIES_PALETTE[0],
  process: CHART_SERIES_PALETTE[1],
  property: CHART_SERIES_PALETTE[2],
  paper: CHART_SERIES_PALETTE[3],
  element: CHART_SERIES_PALETTE[4],
}

const CATEGORY_LABELS: Record<NodeCategory, string> = {
  material: 'Material', process: 'Process', property: 'Property',
  paper: 'Paper', element: 'Element',
}

const ALL_CATEGORIES: NodeCategory[] = ['material', 'process', 'property', 'paper', 'element']

export default function KnowledgeGraphCard({
  artifact,
  onOpenDerivedArtifact,
  onMissingPaperRef,
  className,
}: Props) {
  const payload = artifact.payload as unknown as KnowledgeGraphPayload
  const [visibleCategories, setVisibleCategories] = useState<Set<NodeCategory>>(
    () => new Set(ALL_CATEGORIES),
  )
  const [searchQuery, setSearchQuery] = useState<string>(payload.query ?? '')
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState<boolean>(true)

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const nodes = payload.nodes.filter((n) => {
      if (!visibleCategories.has(n.category)) return false
      if (q && !n.label.toLowerCase().startsWith(q)) return false
      return true
    })
    const nodeIds = new Set(nodes.map((n) => n.id))
    const edges = payload.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
    return { nodes, edges }
  }, [payload.nodes, payload.edges, visibleCategories, searchQuery])

  const selectedNode = useMemo(
    () => (selectedNodeId ? payload.nodes.find((n) => n.id === selectedNodeId) ?? null : null),
    [payload.nodes, selectedNodeId],
  )

  const selectedEdges = useMemo(() => {
    if (!selectedNodeId) return { incoming: [] as KnowledgeEdge[], outgoing: [] as KnowledgeEdge[] }
    const incoming: KnowledgeEdge[] = []
    const outgoing: KnowledgeEdge[] = []
    for (const e of payload.edges) {
      if (e.source === selectedNodeId) outgoing.push(e)
      else if (e.target === selectedNodeId) incoming.push(e)
    }
    return { incoming, outgoing }
  }, [payload.edges, selectedNodeId])

  const nodeLabelMap = useMemo(() => {
    const m: Record<string, string> = {}
    for (const n of payload.nodes) m[n.id] = n.label
    return m
  }, [payload.nodes])

  const chartOption = useMemo(() => buildGraphOption(filtered.nodes, filtered.edges), [filtered])

  const onEvents = useMemo(
    () => ({
      click: (e: { dataType?: string; data?: { id?: string } }) => {
        if (e.dataType === 'node' && e.data?.id) {
          setSelectedNodeId(e.data.id)
          setPanelOpen(true)
        }
      },
    }),
    [],
  )
  const handleOpenPaper = useCallback((node: KnowledgeNode) => {
    if (!node.paperRef) {
      onMissingPaperRef?.(node.label)
      return
    }
    if (!onOpenDerivedArtifact) return

    const next = buildLocalPaperArtifact({
      title: node.label,
      sourceArtifactId: artifact.id,
      reference: node.paperRef,
      authors: parseNodeAuthors(node.label),
      year: parseNodeYear(node.label),
      venue: parseNodeVenue(node.label),
      abstract: `Local paper note created from knowledge-graph node "${node.label}".`,
      note: `Imported from knowledge graph artifact "${artifact.title}".`,
    })

    onOpenDerivedArtifact(next)
  }, [artifact.id, artifact.title, onMissingPaperRef, onOpenDerivedArtifact])

  const toggleCategory = (cat: NodeCategory) => {
    setVisibleCategories((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  const showPanel = panelOpen && selectedNode !== null
  const rootClassName = className
    ? `card-knowledge-graph-root ${className}`
    : 'card-knowledge-graph-root'

  return (
    <div className={rootClassName}>
      <div className="card-knowledge-graph-top-bar">
        <div className="card-knowledge-graph-stats">
          <Badge variant="neutral" leading={<Network size={12} />}>
            {payload.stats.nodeCount} nodes
          </Badge>
          <Badge variant="neutral">{payload.stats.edgeCount} edges</Badge>
        </div>
        <div className="card-knowledge-graph-search-box">
          <Search size={13} className="card-knowledge-graph-search-icon" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter by label prefix..."
            className="card-knowledge-graph-search-input"
          />
        </div>
        <div className="card-knowledge-graph-filter-group">
          {ALL_CATEGORIES.map((cat) => {
            const active = visibleCategories.has(cat)
            const color = CATEGORY_COLORS[cat]
            return (
              <button
                key={cat}
                type="button"
                onClick={() => toggleCategory(cat)}
                title={`Toggle ${CATEGORY_LABELS[cat]}`}
                className={`card-knowledge-graph-filter-btn${active ? ' is-active' : ''}`}
                style={{ '--cat-color': color } as React.CSSProperties}
              >
                <Circle
                  size={9}
                  className="card-knowledge-graph-filter-dot"
                  style={{ '--cat-fill': active ? color : 'transparent' } as React.CSSProperties}
                />
                {CATEGORY_LABELS[cat]}
              </button>
            )
          })}
        </div>
      </div>

      <div className="card-knowledge-graph-body">
        <div className="card-knowledge-graph-chart-wrap">
          <ReactECharts
            option={chartOption}
            onEvents={onEvents}
            notMerge
            className="card-knowledge-graph-echarts"
            opts={{ renderer: 'canvas' }}
          />
        </div>
        {showPanel && selectedNode && (
          <SidePanel
            node={selectedNode}
            incoming={selectedEdges.incoming}
            outgoing={selectedEdges.outgoing}
            nodeLabelMap={nodeLabelMap}
            onOpenPaper={handleOpenPaper}
            onClose={() => setPanelOpen(false)}
          />
        )}
      </div>
    </div>
  )
}

function SidePanel({
  node, incoming, outgoing, nodeLabelMap, onOpenPaper, onClose,
}: {
  node: KnowledgeNode
  incoming: KnowledgeEdge[]
  outgoing: KnowledgeEdge[]
  nodeLabelMap: Record<string, string>
  onOpenPaper: (node: KnowledgeNode) => void
  onClose: () => void
}) {
  const color = CATEGORY_COLORS[node.category]
  return (
    <aside className="card-knowledge-graph-side-panel">
      <div className="card-knowledge-graph-side-header">
        <strong className="card-knowledge-graph-side-title" title={node.label}>{node.label}</strong>
        <IconButton
          icon={<X size={13} />}
          label="Close panel"
          onClick={onClose}
        />
      </div>
      <div className="card-knowledge-graph-side-body">
        <span
          className="card-knowledge-graph-category-chip"
          style={{ '--cat-color': color } as React.CSSProperties}
        >
          {CATEGORY_LABELS[node.category]}
        </span>
        {node.value !== undefined && (
          <div className="card-knowledge-graph-meta-row">
            <span className="card-knowledge-graph-meta-label">value</span>
            <span className="card-knowledge-graph-meta-value">{node.value}</span>
          </div>
        )}
        {node.paperRef && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onOpenPaper(node)}
            title={node.paperRef}
            className="card-knowledge-graph-paper-link"
          >
            {node.paperRef}
          </Button>
        )}
        <EdgeList title="Outgoing" edges={outgoing} nodeLabelMap={nodeLabelMap} direction="out" />
        <EdgeList title="Incoming" edges={incoming} nodeLabelMap={nodeLabelMap} direction="in" />
      </div>
    </aside>
  )
}

function EdgeList({
  title, edges, nodeLabelMap, direction,
}: {
  title: string
  edges: KnowledgeEdge[]
  nodeLabelMap: Record<string, string>
  direction: 'in' | 'out'
}) {
  return (
    <div className="card-knowledge-graph-edge-section">
      <div className="card-knowledge-graph-edge-title">
        {title}{edges.length > 0 ? ` (${edges.length})` : ''}
      </div>
      {edges.length === 0 ? (
        <div className="card-knowledge-graph-empty-line">none</div>
      ) : (
        edges.map((e, i) => {
          const other = direction === 'out' ? e.target : e.source
          const arrow = direction === 'out' ? '>' : '<'
          return (
            <div key={`${e.source}-${e.target}-${i}`} className="card-knowledge-graph-edge-row">
              <span className="card-knowledge-graph-edge-relation">{e.relation}</span>
              <span className="card-knowledge-graph-edge-arrow">{arrow}</span>
              <span
                className="card-knowledge-graph-edge-node"
                title={nodeLabelMap[other] ?? other}
              >
                {nodeLabelMap[other] ?? other}
              </span>
            </div>
          )
        })
      )}
    </div>
  )
}

function parseNodeAuthors(label: string): string[] {
  const head = label.split(',')[0]?.trim()
  return head ? [head] : ['Unknown']
}

function parseNodeVenue(label: string): string | undefined {
  const parts = label.split(',')
  if (parts.length < 2) return undefined
  const venue = parts
    .slice(1)
    .join(',')
    .replace(/\b(18|19|20)\d{2}\b/g, '')
    .replace(/\.+$/g, '')
    .trim()
  return venue || undefined
}

function parseNodeYear(label: string): number | undefined {
  const match = label.match(/\b(18|19|20)\d{2}\b/)
  return match ? Number(match[0]) : undefined
}

function buildGraphOption(nodes: KnowledgeNode[], edges: KnowledgeEdge[]) {
  const categories = ALL_CATEGORIES.map((c) => ({ name: CATEGORY_LABELS[c], itemStyle: { color: CATEGORY_COLORS[c] } }))
  const chartNodes = nodes.map((n) => ({
    id: n.id, name: n.label,
    category: ALL_CATEGORIES.indexOf(n.category),
    symbolSize: n.symbolSize ?? 24,
    value: n.value ?? null,
    itemStyle: { color: CATEGORY_COLORS[n.category] },
    _payload: n,
  }))
  const chartLinks = edges.map((e) => ({
    source: e.source, target: e.target, value: e.relation,
    lineStyle: {
      color: 'rgba(148,163,184,0.45)',
      width: Math.max(1, Math.min(3, e.weight ?? 1)),
      curveness: 0.08,
    },
  }))
  return {
    backgroundColor: 'transparent',
    animation: false,
    tooltip: {
      trigger: 'item' as const,
      backgroundColor: 'rgba(20,20,20,0.96)',
      borderColor: '#2A2A2A',
      extraCssText: 'z-index: 10 !important; pointer-events: none;',
      textStyle: { color: '#cccccc', fontSize: CHART_TEXT_PX.sm },
      formatter: tooltipFormatter,
    },
    legend: [{ show: false, data: categories.map((c) => c.name) }],
    series: [{
      type: 'graph' as const,
      layout: 'force' as const,
      roam: true,
      draggable: true,
      data: chartNodes,
      links: chartLinks,
      categories,
      label: { show: true, position: 'right' as const, color: '#cccccc', fontSize: CHART_TEXT_PX.xs },
      emphasis: {
        focus: 'adjacency' as const,
        lineStyle: { color: CHART_PRIMARY, width: 2 },
        label: { color: '#ffffff' },
      },
      force: { repulsion: 200, gravity: 0.1, edgeLength: [50, 120], friction: 0.25 },
      lineStyle: { color: 'rgba(148,163,184,0.45)', width: 1, curveness: 0.08 },
    }],
  }
}

function tooltipFormatter(params: {
  dataType?: string
  data?: { _payload?: KnowledgeNode; value?: string }
}): string {
  if (params.dataType === 'node' && params.data?._payload) {
    const n = params.data._payload
    const lines = [
      `<strong>${escapeHtml(n.label)}</strong>`,
      `<span style="color:#888888">${CATEGORY_LABELS[n.category]}</span>`,
    ]
    if (n.value !== undefined) lines.push(`value: ${n.value}`)
    if (n.paperRef) lines.push(`ref: ${escapeHtml(n.paperRef)}`)
    return lines.join('<br/>')
  }
  if (params.dataType === 'edge') {
    return `<span style="color:#888888">${escapeHtml(String(params.data?.value ?? ''))}</span>`
  }
  return ''
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
