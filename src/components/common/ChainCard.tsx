// ChainCard — renders a single extracted knowledge chain with a
// readable grouped layout. Four-role model from lattice-cli:
// system → process → state → measurement.
//
// Instead of dumping every node as a repeated vertical row, the card
// groups nodes by role and renders a compact relationship path. This
// keeps old heuristic chains readable while making LLM chains look like
// structured evidence records.

import type { ChainNode } from '../../types/library-api'

/** Subset of fields ChainCard needs — compatible with both
 *  `KnowledgeChain` (library-api) and `KnowledgeChainMatch` (knowledge-api). */
export interface ChainCardData {
  nodes: ChainNode[]
  domain_type?: string
  chain_type?: string
  context_text?: string
  context_section?: string
  confidence?: number
}

const ROLE_LABEL: Record<string, string> = {
  system: 'System',
  process: 'Process',
  state: 'State',
  measurement: 'Measure',
}

const ROLE_ORDER: Record<string, number> = {
  system: 0,
  process: 1,
  state: 2,
  measurement: 3,
}

const ROLE_SEQUENCE = ['system', 'process', 'state', 'measurement']
const MAX_NODES_PER_ROLE = 3

function roleClass(role: string): string {
  const key = role.toLowerCase()
  if (['system', 'process', 'state', 'measurement'].includes(key)) {
    return ` chain-card-role-group--${key}`
  }
  return ''
}

function sortNodes(nodes: ChainNode[]): ChainNode[] {
  const hasOrdinal = nodes.every((n) => typeof n.ordinal === 'number')
  if (hasOrdinal) {
    return [...nodes].sort((a, b) => a.ordinal - b.ordinal)
  }
  return [...nodes].sort(
    (a, b) =>
      (ROLE_ORDER[a.role.toLowerCase()] ?? 99) -
      (ROLE_ORDER[b.role.toLowerCase()] ?? 99),
  )
}

function groupNodes(nodes: ChainNode[]): Array<{ role: string; nodes: ChainNode[] }> {
  const grouped = new Map<string, ChainNode[]>()
  for (const node of nodes) {
    const role = node.role.toLowerCase()
    const bucket = grouped.get(role) ?? []
    bucket.push(node)
    grouped.set(role, bucket)
  }
  const roles = [
    ...ROLE_SEQUENCE.filter((role) => grouped.has(role)),
    ...[...grouped.keys()].filter((role) => !ROLE_SEQUENCE.includes(role)),
  ]
  return roles.map((role) => ({ role, nodes: grouped.get(role) ?? [] }))
}

export interface ChainCardProps {
  chain: ChainCardData
  /** Compact mode: smaller paddings, no source quote. */
  compact?: boolean
}

export default function ChainCard({ chain, compact = false }: ChainCardProps) {
  const nodes = sortNodes(chain.nodes)
  const grouped = groupNodes(nodes)
  const confidencePct =
    typeof chain.confidence === 'number'
      ? Math.round(chain.confidence * 100)
      : null
  const title = buildChainTitle(grouped)
  const sourceLine = chain.context_text || firstNodeLine(nodes)

  return (
    <article className={`chain-card${compact ? ' chain-card--compact' : ''}`}>
      <div className="chain-card-head">
        <div className="chain-card-title" title={title}>{title}</div>
        <div className="chain-card-badges">
          {chain.chain_type && (
            <span className={`chain-card-badge chain-card-badge--${chain.chain_type}`}>
              {formatChainType(chain.chain_type)}
            </span>
          )}
          {confidencePct != null && (
            <span
              className="chain-card-badge"
              title={`Extraction confidence: ${confidencePct}%`}
            >
              {confidencePct}%
            </span>
          )}
        </div>
      </div>

      <div className="chain-card-path">
        {grouped.map((group, index) => (
          <div className="chain-card-path-item" key={group.role}>
            {index > 0 && <span className="chain-card-arrow">→</span>}
            <RoleGroup role={group.role} nodes={group.nodes} compact={compact} />
          </div>
        ))}
      </div>

      {!compact && (sourceLine || chain.context_section || chain.domain_type) && (
        <div className="chain-card-footer">
          {sourceLine && (
            <blockquote className="chain-card-quote">
              “{sourceLine}”
            </blockquote>
          )}
          <div className="chain-card-meta">
            {chain.context_section && (
              <span className="chain-card-section">{chain.context_section}</span>
            )}
            {chain.domain_type && (
              <span className="chain-card-section">{chain.domain_type}</span>
            )}
          </div>
        </div>
      )}
    </article>
  )
}

function RoleGroup({
  role,
  nodes,
  compact,
}: {
  role: string
  nodes: ChainNode[]
  compact: boolean
}) {
  const visible = dedupeNodes(nodes).slice(0, MAX_NODES_PER_ROLE)
  const hidden = Math.max(0, dedupeNodes(nodes).length - visible.length)
  const label = ROLE_LABEL[role] ?? role
  return (
    <section className={`chain-card-role-group${roleClass(role)}`}>
      <div className="chain-card-role-label">{label}</div>
      <div className="chain-card-node-list">
        {visible.map((node, index) => (
          <span className="chain-card-node-chip" key={`${node.role}-${node.name}-${index}`}>
            <span className="chain-card-node-name">{node.name}</span>
            {formatValue(node) && (
              <span className="chain-card-node-value">{formatValue(node)}</span>
            )}
          </span>
        ))}
        {hidden > 0 && (
          <span className="chain-card-node-more" title={nodes.map((n) => n.name).join('\n')}>
            +{hidden} more
          </span>
        )}
        {!compact && visible.length === 0 && (
          <span className="chain-card-node-empty">—</span>
        )}
      </div>
    </section>
  )
}

function dedupeNodes(nodes: ChainNode[]): ChainNode[] {
  const seen = new Set<string>()
  const out: ChainNode[] = []
  for (const node of nodes) {
    const key = `${node.role}|${node.name}|${node.value ?? ''}|${node.unit ?? ''}`.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(node)
  }
  return out
}

function buildChainTitle(groups: Array<{ role: string; nodes: ChainNode[] }>): string {
  const system = firstName(groups, 'system')
  const process = firstName(groups, 'process')
  const measurement = firstName(groups, 'measurement')
  if (system && measurement) return `${system} → ${measurement}`
  if (system && process) return `${system} → ${process}`
  if (process && measurement) return `${process} → ${measurement}`
  return groups
    .map((group) => firstName(groups, group.role))
    .filter(Boolean)
    .slice(0, 2)
    .join(' → ') || 'Knowledge chain'
}

function firstName(groups: Array<{ role: string; nodes: ChainNode[] }>, role: string): string {
  return groups.find((group) => group.role === role)?.nodes[0]?.name ?? ''
}

function firstNodeLine(nodes: ChainNode[]): string {
  for (const node of nodes) {
    const line = node.metadata?.line
    if (typeof line === 'string' && line.trim()) return line
  }
  return ''
}

function formatValue(n: ChainNode): string {
  if (n.value == null || String(n.value).trim() === '') return ''
  const unit = n.unit ? ` ${n.unit}` : ''
  return `${n.value}${unit}`
}

function formatChainType(chainType: string): string {
  if (chainType === 'llm_auto') return 'LLM'
  if (chainType === 'heuristic_fallback') return 'Fallback'
  if (chainType === 'heuristic') return 'Heuristic'
  return chainType.replace(/_/g, ' ')
}
