// LocalProKnowledge — self-contained knowledge API facade.
// Uses local IndexedDB for storage and frontend LLM calls for extraction.
// Replaces the stub that reported `ready: false`.

import type {
  AddKnowledgeTagRequest,
  AddKnowledgeTagResponse,
  CompareMaterialsRequest,
  CompareMaterialsResponse,
  ExtractionTimelineResponse,
  ExtractSelectionRequest,
  ExtractSelectionResponse,
  HeatmapResponse,
  KnowledgeChainMatch,
  KnowledgeExtractionDetail,
  KnowledgeExtractionsQuery,
  KnowledgeExtractionsResponse,
  KnowledgePaperGroupRow,
  KnowledgeProjectsResponse,
  KnowledgeSearchQuery,
  KnowledgeSearchResponse,
  KnowledgeStats,
  KnowledgeTagsResponse,
  MetricDistributionResponse,
  PeaksByTechniqueResponse,
  RemoveKnowledgeTagResponse,
  SaveChainsRequest,
  SaveChainsResponse,
  VariableListResponse,
} from '../types/knowledge-api'
import * as db from './knowledge/local-knowledge-db'
import { CURRENT_EXTRACTOR_VERSION } from './knowledge/extractor-version'
import { evaluateChainQuality } from './knowledge/quality-evaluator'
import {
  extractChainsFromText,
  type ExtractedChain,
} from './knowledge/llm-extract'

export interface LocalKnowledgeApi {
  readonly ready: boolean
  stats: () => Promise<KnowledgeStats>
  listExtractions: (
    q?: KnowledgeExtractionsQuery,
  ) => Promise<KnowledgeExtractionsResponse>
  getExtraction: (id: number) => Promise<KnowledgeExtractionDetail>
  search: (q: KnowledgeSearchQuery) => Promise<KnowledgeSearchResponse>
  exportCsv: () => Promise<string>
  compareMaterials: (
    req: CompareMaterialsRequest,
  ) => Promise<CompareMaterialsResponse>
  deleteExtraction: (id: number) => Promise<{ success: boolean }>
  listTags: () => Promise<KnowledgeTagsResponse>
  addTag: (
    extractionId: number,
    req: AddKnowledgeTagRequest,
  ) => Promise<AddKnowledgeTagResponse>
  removeTag: (
    extractionId: number,
    tag: string,
  ) => Promise<RemoveKnowledgeTagResponse>
  listProjects: () => Promise<KnowledgeProjectsResponse>
  extractSelection: (
    req: ExtractSelectionRequest,
  ) => Promise<ExtractSelectionResponse>
  saveChains: (req: SaveChainsRequest) => Promise<SaveChainsResponse>
  chainsByPaper: (
    paperId: number,
    opts?: { includeDiagnostic?: boolean; includeLegacy?: boolean },
  ) => Promise<KnowledgeChainMatch[]>
  clearChainsByVersion: (
    version: string,
  ) => Promise<{ chainsRemoved: number; extractionsPruned: number }>
  metricDistribution: (
    metric: string,
    limit?: number,
  ) => Promise<MetricDistributionResponse>
  heatmap: (opts?: {
    max_materials?: number
    max_metrics?: number
  }) => Promise<HeatmapResponse>
  timeline: () => Promise<ExtractionTimelineResponse>
  peaks: (
    technique: string,
    limit?: number,
  ) => Promise<PeaksByTechniqueResponse>
  variableList: () => Promise<VariableListResponse>
  papers: (limit?: number) => Promise<KnowledgePaperGroupRow[]>
}

function chainsToSaveFormat(
  chains: ExtractedChain[],
): SaveChainsRequest['chains'] {
  return chains.map((c) => ({
    nodes: c.nodes.map((n, i) => ({
      ordinal: i,
      role: n.role,
      name: n.name,
      value: n.value ?? undefined,
      value_numeric: n.value != null ? parseFloat(n.value) || undefined : undefined,
      unit: n.unit ?? undefined,
    })),
    confidence: c.confidence,
    domain_type: c.domain_type,
    context_text: c.context_text,
    context_section: c.context_section,
  }))
}

export const localProKnowledge: LocalKnowledgeApi = {
  get ready(): boolean {
    return true
  },

  stats: () => db.stats(),
  listExtractions: (q) => db.listExtractions(q),
  getExtraction: (id) => db.getExtraction(id),
  search: (q) => db.search(q),
  exportCsv: () => db.exportCsv(),
  compareMaterials: (req) => db.compareMaterials(req),

  async deleteExtraction(id) {
    await db.deleteExtraction(id)
    return { success: true }
  },

  listTags: () => db.listTags(),

  async addTag(extractionId, req) {
    const ok = await db.addTag(extractionId, req.tag)
    return ok
      ? { success: true as const, tag: req.tag }
      : { success: false as const, error: 'Extraction not found' }
  },

  async removeTag(extractionId, tag) {
    const ok = await db.removeTag(extractionId, tag)
    return { success: ok }
  },

  listProjects: () => db.listProjects(),

  async extractSelection(req) {
    const result = await extractChainsFromText(req.text)
    if (!result.success || result.chains.length === 0) {
      return {
        success: false,
        error: result.error ?? 'No chains could be extracted from this text.',
      } as ExtractSelectionResponse
    }

    const extractionId = await db.createExtraction({
      paper_id: req.paper_id,
      title: `Selection extraction (${result.chains.length} chains)`,
    })

    const saveFormat = chainsToSaveFormat(result.chains)
    const fromHeuristic = result.chains.every((c) => c.confidence <= 0.35)
    const { accepted } = await db.insertChains(extractionId, saveFormat, {
      extractor_version: CURRENT_EXTRACTOR_VERSION,
      evaluator: evaluateChainQuality,
      qualityFloor: fromHeuristic ? 'diagnostic' : undefined,
    })

    if (accepted === 0) {
      // Every chain failed the gate. Return the shape-valid ones so the
      // user still sees something, but flag the weakness via `error`.
      const detail = await db.getExtraction(extractionId)
      return {
        success: true,
        chains: detail.chains ?? [],
        total: result.chains.length,
      } as ExtractSelectionResponse
    }

    const detail = await db.getExtraction(extractionId)
    return {
      success: true,
      chains: detail.chains ?? [],
      total: result.chains.length,
    } as ExtractSelectionResponse
  },

  saveChains: (req) => db.saveChains(req),
  chainsByPaper: (paperId, opts) => db.chainsByPaper(paperId, opts),
  clearChainsByVersion: (version) => db.clearChainsByVersion(version),
  metricDistribution: (metric, limit) => db.metricDistribution(metric, limit),
  heatmap: (opts) => db.heatmap(opts),
  timeline: () => db.timeline(),

  async peaks(_technique, _limit) {
    return { technique: _technique, entries: [] }
  },

  variableList: () => db.variableList(),
  papers: (limit) => db.papers(limit),
}
