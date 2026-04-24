// Derived analytics read-paths: cross-chain aggregates, comparisons,
// and CSV export. These build on top of the primary read surface but
// belong in their own module to keep the core query layer focused on
// the KnowledgeApi one-to-one methods (stats / list / get / search).

import type {
  CompareMaterialsRequest,
  CompareMaterialsResponse,
  ExtractionTimelineResponse,
  HeatmapResponse,
  KnowledgePaperGroupRow,
  KnowledgeStats,
  MetricDistributionResponse,
  VariableListResponse,
} from '../../../types/knowledge-api'
import type { ChainNode } from '../../../types/library-api'
import { ensureInit } from './init'
import { getAll } from './transactions'
import type { DbChain, DbExtraction } from './types'

export async function compareMaterials(req: CompareMaterialsRequest): Promise<CompareMaterialsResponse> {
  await ensureInit()
  const allChains = await getAll<DbChain>('chains')
  const materials = req.materials
  const metricNames = new Set<string>()

  for (const c of allChains) {
    const hasMaterial = c.nodes.some(
      (n) => n.role === 'system' && materials.some((m) => n.name.toLowerCase().includes(m.toLowerCase())),
    )
    if (hasMaterial) {
      for (const n of c.nodes) {
        if (n.role === 'measurement') metricNames.add(n.name)
      }
    }
  }

  const metrics = req.metrics?.length ? req.metrics : [...metricNames].slice(0, 10)
  const data: CompareMaterialsResponse['data'] = materials.map((mat) => {
    return metrics.map((met) => {
      for (const c of allChains) {
        const hasMat = c.nodes.some(
          (n) => n.role === 'system' && n.name.toLowerCase().includes(mat.toLowerCase()),
        )
        const measNode = c.nodes.find(
          (n) => n.role === 'measurement' && n.name.toLowerCase().includes(met.toLowerCase()),
        )
        if (hasMat && measNode) {
          return {
            value: measNode.value_numeric ?? measNode.value ?? undefined,
            unit: measNode.unit ?? undefined,
            chain_id: c.id,
          }
        }
      }
      return null
    })
  })

  return { materials, metrics, data }
}

export async function heatmap(
  statsFn: () => Promise<KnowledgeStats>,
  opts?: {
    max_materials?: number
    max_metrics?: number
  },
): Promise<HeatmapResponse> {
  const s = await statsFn()
  const materials = s.top_materials.slice(0, opts?.max_materials ?? 10).map((m) => m.name)
  const metrics = s.top_metrics.slice(0, opts?.max_metrics ?? 10).map((m) => m.name)
  const result = await compareMaterials({ materials, metrics })
  const numericData = result.data.map((row) =>
    row.map((cell) => {
      if (!cell?.value) return null
      if (typeof cell.value === 'number') return cell.value
      const n = parseFloat(String(cell.value))
      return Number.isFinite(n) ? n : null
    }),
  )
  return { materials, metrics, data: numericData }
}

export async function timeline(): Promise<ExtractionTimelineResponse> {
  await ensureInit()
  const extractions = await getAll<DbExtraction>('extractions')
  const byDate: Record<string, { chains: number; nodes: number; papers: number }> = {}
  for (const e of extractions) {
    const date = e.extracted_at.slice(0, 10)
    const entry = byDate[date] ?? (byDate[date] = { chains: 0, nodes: 0, papers: 0 })
    entry.chains += e.chain_count
    entry.nodes += e.node_count
    entry.papers += 1
  }
  const dates = Object.keys(byDate).sort()
  return {
    dates,
    chains: dates.map((d) => byDate[d].chains),
    nodes: dates.map((d) => byDate[d].nodes),
    papers: dates.map((d) => byDate[d].papers),
  }
}

export async function metricDistribution(
  metric: string,
  limit = 20,
): Promise<MetricDistributionResponse> {
  await ensureInit()
  const allChains = await getAll<DbChain>('chains')
  const groups: Record<string, number[]> = {}
  for (const c of allChains) {
    const system = c.nodes.find((n) => n.role === 'system')?.name ?? 'Unknown'
    const meas = c.nodes.find(
      (n) => n.role === 'measurement' && n.name.toLowerCase().includes(metric.toLowerCase()),
    )
    if (meas) {
      const val = meas.value_numeric ?? (meas.value != null ? parseFloat(meas.value) : NaN)
      if (Number.isFinite(val)) {
        const g = groups[system] ?? (groups[system] = [])
        g.push(val)
      }
    }
  }
  return {
    metric,
    groups: Object.entries(groups)
      .slice(0, limit)
      .map(([name, values]) => ({ name, values, count: values.length })),
  }
}

export async function variableList(): Promise<VariableListResponse> {
  await ensureInit()
  const allChains = await getAll<DbChain>('chains')
  const vars: Record<string, { role: string; unit?: string; examples: Set<string>; count: number }> = {}
  for (const c of allChains) {
    for (const n of c.nodes) {
      const v = vars[n.name] ?? (vars[n.name] = { role: n.role, unit: n.unit ?? undefined, examples: new Set(), count: 0 })
      v.count++
      if (n.value) v.examples.add(String(n.value))
    }
  }
  return {
    variables: Object.entries(vars).map(([name, v]) => ({
      name,
      role: v.role,
      unit: v.unit,
      examples: [...v.examples].slice(0, 5),
      count: v.count,
    })),
  }
}

export async function papers(limit = 50): Promise<KnowledgePaperGroupRow[]> {
  await ensureInit()
  const extractions = await getAll<DbExtraction>('extractions')
  const allChains = await getAll<DbChain>('chains')
  const chainsByExt = new Map<number, DbChain[]>()
  for (const c of allChains) {
    const list = chainsByExt.get(c.extraction_id) ?? []
    list.push(c)
    chainsByExt.set(c.extraction_id, list)
  }

  return extractions.slice(0, limit).map((e) => {
    const chains = chainsByExt.get(e.id) ?? []
    const materials = new Set<string>()
    const metrics: KnowledgePaperGroupRow['metrics'] = []
    for (const c of chains) {
      for (const n of c.nodes) {
        if (n.role === 'system') materials.add(n.name)
        if (n.role === 'measurement') {
          metrics.push({
            name: n.name,
            value: n.value_numeric ?? n.value ?? undefined,
            unit: n.unit ?? undefined,
          })
        }
      }
    }
    return {
      paper_id: e.paper_id ?? undefined,
      title: e.title,
      doi: e.doi || undefined,
      materials: [...materials],
      metrics: metrics.slice(0, 20),
      chain_count: chains.length,
    }
  })
}

export async function exportCsv(): Promise<string> {
  await ensureInit()
  const allChains = await getAll<DbChain>('chains')
  const allExtractions = await getAll<DbExtraction>('extractions')
  const extMap = new Map(allExtractions.map((e) => [e.id, e]))

  const header = 'chain_id,paper_title,confidence,system,process,state,measurement,context'
  const rows = allChains.map((c) => {
    const ext = extMap.get(c.extraction_id)
    const get = (role: string) => c.nodes.find((n) => n.role === role)
    const sys = get('system')
    const proc = get('process')
    const state = get('state')
    const meas = get('measurement')
    const fmt = (n: ChainNode | undefined) => n ? `${n.name}${n.value ? '=' + n.value : ''}${n.unit ? ' ' + n.unit : ''}` : ''
    return [
      c.id,
      `"${(ext?.title ?? '').replace(/"/g, '""')}"`,
      c.confidence.toFixed(2),
      `"${fmt(sys)}"`,
      `"${fmt(proc)}"`,
      `"${fmt(state)}"`,
      `"${fmt(meas)}"`,
      `"${c.context_text.replace(/"/g, '""').slice(0, 100)}"`,
    ].join(',')
  })

  return [header, ...rows].join('\n')
}
