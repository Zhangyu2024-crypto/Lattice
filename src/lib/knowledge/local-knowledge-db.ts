// Local IndexedDB-backed knowledge database.
// Replaces the Python backend for self-contained operation.
//
// This module is intentionally a thin composition layer: schema,
// transactions, init/id state, write ops, and derived analytics live
// in `./local-knowledge-db/*`. The core KnowledgeApi read surface
// (stats / listExtractions / getExtraction / search / listTags /
// listProjects / saveChains) lives here because it is the primary
// query path and is tightly coupled to the Db* row shapes.

import type {
  CompareMaterialsRequest,
  CompareMaterialsResponse,
  ExtractionTimelineResponse,
  HeatmapResponse,
  KnowledgeChainMatch,
  KnowledgeExtractionDetail,
  KnowledgeExtractionRow,
  KnowledgeExtractionsQuery,
  KnowledgeExtractionsResponse,
  KnowledgePaperGroupRow,
  KnowledgeProject,
  KnowledgeSearchQuery,
  KnowledgeSearchResponse,
  KnowledgeStats,
  KnowledgeTag,
  MetricDistributionResponse,
  SaveChainsRequest,
  SaveChainsResponse,
  VariableListResponse,
} from '../../types/knowledge-api'
import {
  compareMaterials as _compareMaterials,
  exportCsv as _exportCsv,
  heatmap as _heatmap,
  metricDistribution as _metricDistribution,
  papers as _papers,
  timeline as _timeline,
  variableList as _variableList,
} from './local-knowledge-db/analytics'
import { ensureInit } from './local-knowledge-db/init'
import { getAll, getAllByIndex } from './local-knowledge-db/transactions'
import type { DbChain, DbExtraction, DbProject } from './local-knowledge-db/types'
import {
  createExtraction,
  insertChains,
} from './local-knowledge-db/writes'

// ── Write-side re-exports ─────────────────────────────────────────
// Pass-through exports so `import * as db from '...'` consumers keep
// working unchanged.

export {
  addTag,
  clearChainsByVersion,
  createExtraction,
  createProject,
  deleteExtraction,
  insertChains,
  removeTag,
} from './local-knowledge-db/writes'
export type { InsertChainsOptions, InsertChainsResult } from './local-knowledge-db/writes'

// ── Core KnowledgeApi read surface ────────────────────────────────

export async function stats(): Promise<KnowledgeStats> {
  await ensureInit()
  const extractions = await getAll<DbExtraction>('extractions')
  const chains = await getAll<DbChain>('chains')
  const nodesByRole: Record<string, number> = {}
  const materialCounts: Record<string, number> = {}
  const metricCounts: Record<string, number> = {}
  for (const c of chains) {
    for (const n of c.nodes) {
      nodesByRole[n.role] = (nodesByRole[n.role] ?? 0) + 1
      if (n.role === 'system') {
        materialCounts[n.name] = (materialCounts[n.name] ?? 0) + 1
      }
      if (n.role === 'measurement') {
        metricCounts[n.name] = (metricCounts[n.name] ?? 0) + 1
      }
    }
  }
  const topMaterials = Object.entries(materialCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }))
  const topMetrics = Object.entries(metricCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }))

  return {
    total_extractions: extractions.length,
    total_chains: chains.length,
    total_nodes: chains.reduce((s, c) => s + c.nodes.length, 0),
    total_tables: 0,
    nodes_by_role: nodesByRole,
    top_materials: topMaterials,
    top_metrics: topMetrics,
  }
}

export async function listExtractions(
  q?: KnowledgeExtractionsQuery,
): Promise<KnowledgeExtractionsResponse> {
  await ensureInit()
  let extractions = await getAll<DbExtraction>('extractions')
  extractions.sort((a, b) => b.id - a.id)
  if (q?.q) {
    const lower = q.q.toLowerCase()
    extractions = extractions.filter(
      (e) => e.title.toLowerCase().includes(lower) || e.doi.toLowerCase().includes(lower),
    )
  }
  if (q?.tag) {
    extractions = extractions.filter((e) => e.tags.includes(q.tag!))
  }
  const total = extractions.length
  const page = q?.page ?? 1
  const limit = q?.limit ?? 25
  const start = (page - 1) * limit
  return {
    extractions: extractions.slice(start, start + limit) as KnowledgeExtractionRow[],
    total,
  }
}

export async function getExtraction(id: number): Promise<KnowledgeExtractionDetail> {
  await ensureInit()
  const extractions = await getAll<DbExtraction>('extractions')
  const ext = extractions.find((e) => e.id === id)
  if (!ext) throw new Error(`Extraction ${id} not found`)
  const chains = await getAllByIndex<DbChain>('chains', 'extraction_id', id)
  return {
    ...ext,
    project_id: ext.project_id ?? undefined,
    chains: chains.map((c) => ({
      id: c.id,
      extraction_id: c.extraction_id,
      domain_type: c.domain_type,
      chain_type: c.chain_type,
      context_text: c.context_text,
      context_section: c.context_section,
      confidence: c.confidence,
      nodes: c.nodes,
    })),
  }
}

export async function search(q: KnowledgeSearchQuery): Promise<KnowledgeSearchResponse> {
  await ensureInit()
  const allChains = await getAll<DbChain>('chains')
  const allExtractions = await getAll<DbExtraction>('extractions')
  const extMap = new Map(allExtractions.map((e) => [e.id, e]))
  const minConf = q.min_confidence ?? 0

  let matches = allChains
    .filter((c) => c.confidence >= minConf)
    .filter((c) => keepByQuality(c, q.include_diagnostic, q.include_legacy))

  if (q.material) {
    const m = q.material.toLowerCase()
    matches = matches.filter((c) =>
      c.nodes.some((n) => n.role === 'system' && n.name.toLowerCase().includes(m)),
    )
  }
  if (q.metric) {
    const m = q.metric.toLowerCase()
    matches = matches.filter((c) =>
      c.nodes.some((n) => n.role === 'measurement' && n.name.toLowerCase().includes(m)),
    )
  }
  if (q.technique) {
    const t = q.technique.toLowerCase()
    matches = matches.filter((c) =>
      c.domain_type.toLowerCase().includes(t) ||
      c.nodes.some((n) => n.name.toLowerCase().includes(t)),
    )
  }
  if (q.tag) {
    const tagExtractionIds = new Set(
      allExtractions.filter((e) => e.tags.includes(q.tag!)).map((e) => e.id),
    )
    matches = matches.filter((c) => tagExtractionIds.has(c.extraction_id))
  }
  if (q.q) {
    const words = q.q.toLowerCase().split(/\s+/)
    matches = matches.filter((c) => {
      const text = [c.context_text, c.domain_type, ...c.nodes.map((n) => n.name)]
        .join(' ')
        .toLowerCase()
      return words.every((w) => text.includes(w))
    })
  }

  const limit = q.limit ?? 25
  const results: KnowledgeChainMatch[] = matches.slice(0, limit).map((c) => {
    const ext = extMap.get(c.extraction_id)
    return {
      chain_id: c.id,
      extraction_id: c.extraction_id,
      paper_id: ext?.paper_id ?? undefined,
      paper_title: ext?.title,
      domain_type: c.domain_type,
      chain_type: c.chain_type,
      extractor_version: c.extractor_version,
      quality: c.quality,
      confidence: c.confidence,
      context_section: c.context_section || undefined,
      context_text: c.context_text || undefined,
      nodes: c.nodes,
    }
  })

  if (q.material) return { type: 'material', data: { results } }
  if (q.tag) return { type: 'tag', results, tag: q.tag }
  if (q.q) return { type: 'fts', results }
  return { type: 'browse', results }
}

export async function listTags(): Promise<KnowledgeTag[]> {
  await ensureInit()
  const extractions = await getAll<DbExtraction>('extractions')
  const counts: Record<string, number> = {}
  for (const e of extractions) {
    for (const t of e.tags) counts[t] = (counts[t] ?? 0) + 1
  }
  return Object.entries(counts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
}

export async function listProjects(): Promise<KnowledgeProject[]> {
  await ensureInit()
  const projects = await getAll<DbProject>('projects')
  const extractions = await getAll<DbExtraction>('extractions')
  return projects.map((p) => ({
    ...p,
    extraction_count: extractions.filter((e) => e.project_id === p.id).length,
  }))
}

export interface ChainsByPaperOptions {
  /** Include chains that the v2 quality gate flagged as diagnostic
   *  (kept in DB for debugging, hidden by default). */
  includeDiagnostic?: boolean
  /** Include pre-v2 chains (tagged during DB migration). These predate
   *  the quality gate and are typically low-signal. */
  includeLegacy?: boolean
}

export async function chainsByPaper(
  paperId: number,
  opts: ChainsByPaperOptions = {},
): Promise<KnowledgeChainMatch[]> {
  await ensureInit()
  const extractions = await getAllByIndex<DbExtraction>('extractions', 'paper_id', paperId)
  if (extractions.length === 0) return []
  const extIds = new Set(extractions.map((e) => e.id))
  const extMap = new Map(extractions.map((e) => [e.id, e]))
  const allChains = await getAll<DbChain>('chains')
  const matched = allChains
    .filter((c) => extIds.has(c.extraction_id))
    .filter((c) => keepByQuality(c, opts.includeDiagnostic, opts.includeLegacy))
    .sort((a, b) => {
      const extA = extMap.get(a.extraction_id)
      const extB = extMap.get(b.extraction_id)
      const timeA = Date.parse(extA?.extracted_at ?? '') || 0
      const timeB = Date.parse(extB?.extracted_at ?? '') || 0
      if (timeA !== timeB) return timeB - timeA
      const qualityA = chainQualityRank(a.quality, a.chain_type)
      const qualityB = chainQualityRank(b.quality, b.chain_type)
      if (qualityA !== qualityB) return qualityB - qualityA
      if (a.confidence !== b.confidence) return b.confidence - a.confidence
      return b.id - a.id
    })
  return matched.map((c) => {
    const ext = extMap.get(c.extraction_id)
    return {
      chain_id: c.id,
      extraction_id: c.extraction_id,
      paper_id: paperId,
      paper_title: ext?.title,
      domain_type: c.domain_type,
      chain_type: c.chain_type,
      extractor_version: c.extractor_version,
      quality: c.quality,
      confidence: c.confidence,
      context_section: c.context_section || undefined,
      context_text: c.context_text || undefined,
      nodes: c.nodes,
    }
  })
}

/** Apply the default read-path quality gate: hide legacy + diagnostic
 *  unless the caller opts in. Chains written before v2 had no `quality`
 *  field — we treat those as legacy. */
function keepByQuality(
  chain: DbChain,
  includeDiagnostic: boolean | undefined,
  includeLegacy: boolean | undefined,
): boolean {
  const q = chain.quality ?? 'legacy'
  if (q === 'accepted') return true
  if (q === 'diagnostic') return includeDiagnostic === true
  if (q === 'legacy') return includeLegacy === true
  return false
}

function chainQualityRank(quality: string | undefined, chainType: string): number {
  // Quality first (v2), chain_type second (source hint for tie-breaking).
  if (quality === 'accepted') return 5
  if (quality === 'diagnostic') return 3
  if (quality === 'legacy') {
    if (chainType === 'llm_auto') return 2
    if (chainType === 'heuristic_fallback') return 1
    return 0
  }
  return 0
}

export async function saveChains(req: SaveChainsRequest): Promise<SaveChainsResponse> {
  await ensureInit()
  const extractionId = await createExtraction({
    paper_id: req.paper_id,
    title: 'Manual extraction',
  })
  // When the caller opts into the v2 pipeline by supplying an
  // `extractor_version`, route the chains through the quality gate.
  // Otherwise stay generic (legacy quality, no evaluator) — this keeps
  // external consumers of saveChains unchanged.
  const useGate = typeof req.extractor_version === 'string' && req.extractor_version.length > 0
  const { evaluateChainQuality } = await import('./quality-evaluator')
  const result = await insertChains(extractionId, req.chains, useGate
    ? {
        extractor_version: req.extractor_version,
        evaluator: evaluateChainQuality,
        qualityFloor: req.quality_floor,
      }
    : {})
  return {
    success: true,
    extraction_id: extractionId,
    chain_ids: result.chainIds,
    count: result.chainIds.length,
    accepted: useGate ? result.accepted : result.chainIds.length,
    diagnostic: result.diagnostic,
    rejected: result.rejected,
    rejected_details: result.rejectedDetails,
  }
}

// ── Analytics wrappers ────────────────────────────────────────────
// Thin adapters that preserve the original public signatures while the
// implementations live in `./local-knowledge-db/analytics`. `heatmap`
// binds the local `stats` fn to keep analytics free of circular imports.

export function compareMaterials(req: CompareMaterialsRequest): Promise<CompareMaterialsResponse> {
  return _compareMaterials(req)
}

export function heatmap(opts?: {
  max_materials?: number
  max_metrics?: number
}): Promise<HeatmapResponse> {
  return _heatmap(stats, opts)
}

export function timeline(): Promise<ExtractionTimelineResponse> {
  return _timeline()
}

export function metricDistribution(
  metric: string,
  limit?: number,
): Promise<MetricDistributionResponse> {
  return _metricDistribution(metric, limit)
}

export function variableList(): Promise<VariableListResponse> {
  return _variableList()
}

export function papers(limit?: number): Promise<KnowledgePaperGroupRow[]> {
  return _papers(limit)
}

export function exportCsv(): Promise<string> {
  return _exportCsv()
}
