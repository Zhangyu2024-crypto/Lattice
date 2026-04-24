import { useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { Network, X } from 'lucide-react'
import { buildChainGraph, type ChainGraphLink, type ChainGraphNode, type ChainGraphRole } from '../../lib/knowledge/chain-graph'
import { CHART_TEXT_PX } from '../../lib/chart-text-px'
import type { KnowledgeChain } from '../../types/library-api'
import type { KnowledgeChainMatch } from '../../types/knowledge-api'
import { Button, EmptyState, IconButton } from '../ui'

export type KnowledgeChainGraphChain = KnowledgeChain | KnowledgeChainMatch

interface Props {
  chains: KnowledgeChainGraphChain[]
  height?: number
  emptyTitle?: string
}

const ROLE_LABEL: Record<ChainGraphRole, string> = {
  system: 'System',
  process: 'Process',
  state: 'State',
  measurement: 'Measure',
  other: 'Other',
}

const ROLE_COLOR: Record<ChainGraphRole, string> = {
  system: '#94a3b8',
  process: '#f59e0b',
  state: '#a78bfa',
  measurement: '#34d399',
  other: '#d4d4d4',
}

const ROLE_ORDER: ChainGraphRole[] = ['system', 'process', 'state', 'measurement', 'other']

export default function KnowledgeChainGraph({
  chains,
  height = 360,
  emptyTitle = 'No graphable chains',
}: Props) {
  const graph = useMemo(() => buildChainGraph(chains), [chains])
  const [selected, setSelected] = useState<
    | { type: 'node'; node: ChainGraphNode }
    | { type: 'link'; link: ChainGraphLink }
    | null
  >(null)
  const nodeMap = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes],
  )
  const option = useMemo(() => buildOption(graph.nodes, graph.links), [graph])
  const onEvents = useMemo(
    () => ({
      click: (event: { dataType?: string; data?: { id?: string; _kind?: string } }) => {
        if (event.dataType === 'node' && event.data?.id) {
          const node = graph.nodes.find((n) => n.id === event.data?.id)
          if (node) setSelected({ type: 'node', node })
        }
        if (event.dataType === 'edge' && event.data?.id) {
          const link = graph.links.find((l) => l.id === event.data?.id)
          if (link) setSelected({ type: 'link', link })
        }
      },
    }),
    [graph.links, graph.nodes],
  )

  if (graph.nodes.length === 0) {
    return (
      <EmptyState
        compact
        icon={<Network size={16} />}
        title={emptyTitle}
        hint="Extract LLM chains first, then switch back to Graph."
      />
    )
  }

  return (
    <div className="knowledge-chain-graph">
      <div className="knowledge-chain-graph-stage" style={{ minHeight: height }}>
        <ReactECharts
          option={option}
          onEvents={onEvents}
          notMerge
          className="knowledge-chain-graph-chart"
          style={{ height }}
          opts={{ renderer: 'canvas' }}
        />
      </div>
      <div className="knowledge-chain-graph-legend">
        {ROLE_ORDER.map((role) => (
          <span key={role} className="knowledge-chain-graph-legend-item">
            <span
              className="knowledge-chain-graph-legend-dot"
              style={{ background: ROLE_COLOR[role] }}
            />
            {ROLE_LABEL[role]}
          </span>
        ))}
      </div>
      {selected && (
        <GraphInspector
          selected={selected}
          nodeMap={nodeMap}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

function GraphInspector({
  selected,
  nodeMap,
  onClose,
}: {
  selected: { type: 'node'; node: ChainGraphNode } | { type: 'link'; link: ChainGraphLink }
  nodeMap: Map<string, ChainGraphNode>
  onClose: () => void
}) {
  if (selected.type === 'node') {
    const node = selected.node
    return (
      <aside className="knowledge-chain-graph-inspector">
        <div className="knowledge-chain-graph-inspector-head">
          <strong title={node.label}>{node.label}</strong>
          <IconButton icon={<X size={13} />} label="Close graph inspector" onClick={onClose} />
        </div>
        <div className="knowledge-chain-graph-inspector-body">
          <Meta label="Role" value={ROLE_LABEL[node.role]} />
          <Meta label="Chains" value={String(node.chainIds.length)} />
          <Meta label="Confidence" value={`${Math.round(node.confidence * 100)}%`} />
          {node.values.length > 0 && <Meta label="Values" value={node.values.slice(0, 4).join(', ')} />}
        </div>
      </aside>
    )
  }

  const link = selected.link
  const source = nodeMap.get(link.source)
  const target = nodeMap.get(link.target)
  return (
    <aside className="knowledge-chain-graph-inspector">
      <div className="knowledge-chain-graph-inspector-head">
        <strong>{link.relation}</strong>
        <IconButton icon={<X size={13} />} label="Close graph inspector" onClick={onClose} />
      </div>
      <div className="knowledge-chain-graph-inspector-body">
        <Meta label="Source" value={source?.label ?? link.source} />
        <Meta label="Target" value={target?.label ?? link.target} />
        <Meta label="Evidence" value={`${link.chainIds.length} chain${link.chainIds.length === 1 ? '' : 's'}`} />
        <Meta label="Confidence" value={`${Math.round(link.confidence * 100)}%`} />
        {link.contexts.length > 0 && (
          <div className="knowledge-chain-graph-evidence-list">
            {link.contexts.slice(0, 3).map((context, index) => (
              <blockquote key={index}>“{context}”</blockquote>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="knowledge-chain-graph-meta-row">
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  )
}

function buildOption(nodes: ChainGraphNode[], links: ChainGraphLink[]) {
  const categories = ROLE_ORDER.map((role) => ({
    name: ROLE_LABEL[role],
    itemStyle: { color: ROLE_COLOR[role] },
  }))
  return {
    backgroundColor: 'transparent',
    animation: false,
    tooltip: {
      trigger: 'item' as const,
      backgroundColor: 'rgba(18,18,18,0.96)',
      borderColor: '#2a2a2a',
      textStyle: { color: '#d4d4d4', fontSize: CHART_TEXT_PX.xs },
      formatter: tooltipFormatter,
    },
    series: [{
      type: 'graph' as const,
      layout: 'force' as const,
      roam: true,
      draggable: true,
      categories,
      data: nodes.map((node) => ({
        id: node.id,
        name: node.label,
        category: ROLE_ORDER.indexOf(node.role),
        symbolSize: Math.max(22, Math.min(48, 20 + node.count * 5)),
        value: node.count,
        itemStyle: { color: ROLE_COLOR[node.role] },
        label: { show: node.count > 1 || node.role === 'system' || node.role === 'measurement' },
        _node: node,
      })),
      links: links.map((link) => ({
        id: link.id,
        source: link.source,
        target: link.target,
        value: link.relation,
        lineStyle: {
          width: Math.max(1, Math.min(5, 1 + link.count)),
          color: 'rgba(148,163,184,0.48)',
          curveness: 0.12,
        },
        _link: link,
      })),
      label: {
        show: true,
        position: 'right' as const,
        color: '#d4d4d4',
        fontSize: CHART_TEXT_PX.xs,
        formatter: (params: { name?: string }) => truncate(params.name ?? '', 22),
      },
      edgeLabel: {
        show: false,
      },
      emphasis: {
        focus: 'adjacency' as const,
        lineStyle: { width: 3, color: '#d4d4d4' },
      },
      force: {
        repulsion: 180,
        gravity: 0.08,
        edgeLength: [60, 130],
        friction: 0.35,
      },
    }],
  }
}

function tooltipFormatter(params: {
  dataType?: string
  data?: { _node?: ChainGraphNode; _link?: ChainGraphLink; value?: string }
}): string {
  if (params.dataType === 'node' && params.data?._node) {
    const node = params.data._node
    return [
      `<strong>${escapeHtml(node.label)}</strong>`,
      `${ROLE_LABEL[node.role]} · ${node.chainIds.length} chain(s)`,
      `confidence ${Math.round(node.confidence * 100)}%`,
    ].join('<br/>')
  }
  if (params.dataType === 'edge' && params.data?._link) {
    const link = params.data._link
    return [
      `<strong>${escapeHtml(link.relation)}</strong>`,
      `${link.chainIds.length} evidence chain(s)`,
      `confidence ${Math.round(link.confidence * 100)}%`,
    ].join('<br/>')
  }
  return ''
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
