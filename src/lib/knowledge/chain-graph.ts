import type { ChainNode, KnowledgeChain } from '../../types/library-api'
import type { KnowledgeChainMatch } from '../../types/knowledge-api'

export type ChainGraphRole = 'system' | 'process' | 'state' | 'measurement' | 'other'

export interface ChainGraphNode {
  id: string
  label: string
  role: ChainGraphRole
  count: number
  chainIds: number[]
  paperIds: number[]
  confidence: number
  values: string[]
}

export interface ChainGraphLink {
  id: string
  source: string
  target: string
  relation: string
  count: number
  chainIds: number[]
  paperIds: number[]
  confidence: number
  contexts: string[]
}

export interface ChainGraphData {
  nodes: ChainGraphNode[]
  links: ChainGraphLink[]
}

type ChainLike = KnowledgeChain | KnowledgeChainMatch

const ROLE_SEQUENCE: ChainGraphRole[] = ['system', 'process', 'state', 'measurement']

const RELATION_BY_TARGET: Record<ChainGraphRole, string> = {
  system: 'related_to',
  process: 'processed_by',
  state: 'produces_state',
  measurement: 'measured_as',
  other: 'related_to',
}

export function buildChainGraph(chains: ChainLike[]): ChainGraphData {
  const nodeMap = new Map<string, ChainGraphNode>()
  const linkMap = new Map<string, ChainGraphLink>()

  for (const chain of chains) {
    const chainId = getChainId(chain)
    const paperId = getPaperId(chain)
    const confidence = typeof chain.confidence === 'number' ? chain.confidence : 0.5
    const context = chain.context_text?.trim() ?? ''
    const pathNodes = buildPathNodes(chain.nodes ?? [])
    if (pathNodes.length === 0) continue

    const graphNodeIds: string[] = []
    for (const node of pathNodes) {
      const role = normalizeRole(node.role)
      const label = normalizeLabel(node.name)
      if (!label) continue
      const value = formatValue(node)
      const id = `${role}:${canonical(label)}${value ? `:${canonical(value)}` : ''}`
      graphNodeIds.push(id)
      const existing = nodeMap.get(id)
      if (existing) {
        existing.count += 1
        existing.confidence = Math.max(existing.confidence, confidence)
        pushUnique(existing.chainIds, chainId)
        if (paperId != null) pushUnique(existing.paperIds, paperId)
        if (value) pushUnique(existing.values, value)
      } else {
        nodeMap.set(id, {
          id,
          label,
          role,
          count: 1,
          chainIds: [chainId],
          paperIds: paperId != null ? [paperId] : [],
          confidence,
          values: value ? [value] : [],
        })
      }
    }

    for (let i = 0; i < graphNodeIds.length - 1; i++) {
      const source = graphNodeIds[i]
      const target = graphNodeIds[i + 1]
      if (source === target) continue
      const targetRole = nodeMap.get(target)?.role ?? 'other'
      const relation = RELATION_BY_TARGET[targetRole] ?? 'related_to'
      const id = `${source}->${relation}->${target}`
      const existing = linkMap.get(id)
      if (existing) {
        existing.count += 1
        existing.confidence = Math.max(existing.confidence, confidence)
        pushUnique(existing.chainIds, chainId)
        if (paperId != null) pushUnique(existing.paperIds, paperId)
        if (context) pushUnique(existing.contexts, context)
      } else {
        linkMap.set(id, {
          id,
          source,
          target,
          relation,
          count: 1,
          chainIds: [chainId],
          paperIds: paperId != null ? [paperId] : [],
          confidence,
          contexts: context ? [context] : [],
        })
      }
    }
  }

  return {
    nodes: [...nodeMap.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    links: [...linkMap.values()].sort((a, b) => b.count - a.count || a.relation.localeCompare(b.relation)),
  }
}

function buildPathNodes(nodes: ChainNode[]): ChainNode[] {
  const byRole = new Map<ChainGraphRole, ChainNode[]>()
  const sorted = [...nodes].sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0))
  for (const node of sorted) {
    const role = normalizeRole(node.role)
    const bucket = byRole.get(role) ?? []
    if (!bucket.some((n) => nodeSig(n) === nodeSig(node))) bucket.push(node)
    byRole.set(role, bucket)
  }
  const out: ChainNode[] = []
  for (const role of ROLE_SEQUENCE) {
    const picked = byRole.get(role)?.slice(0, 2) ?? []
    out.push(...picked)
  }
  const other = byRole.get('other')?.slice(0, 2) ?? []
  out.push(...other)
  return out
}

function getChainId(chain: ChainLike): number {
  if ('chain_id' in chain) return chain.chain_id
  return chain.id
}

function getPaperId(chain: ChainLike): number | null {
  return 'paper_id' in chain && typeof chain.paper_id === 'number' ? chain.paper_id : null
}

function normalizeRole(role: string): ChainGraphRole {
  const lower = role.toLowerCase()
  if (lower === 'system' || lower === 'process' || lower === 'state' || lower === 'measurement') return lower
  return 'other'
}

function normalizeLabel(label: string): string {
  return label.replace(/\s+/g, ' ').trim()
}

function canonical(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9α-ωµμ]+/gi, ' ').trim().replace(/\s+/g, '-')
}

function nodeSig(node: ChainNode): string {
  return `${node.role}|${normalizeLabel(node.name)}|${formatValue(node)}`.toLowerCase()
}

function formatValue(node: ChainNode): string {
  if (node.value == null || String(node.value).trim() === '') return ''
  return `${node.value}${node.unit ? ` ${node.unit}` : ''}`
}

function pushUnique<T>(array: T[], value: T): void {
  if (!array.includes(value)) array.push(value)
}
