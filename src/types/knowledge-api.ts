// Types for /api/knowledge/* endpoints.
// Derived from server.py + state_bridge.py + knowledge_db.py schema at
// `src/lattice_cli/knowledge_db.py:93-182`.

import type { ChainNode, KnowledgeChain } from './library-api'

// ─── Stats ─────────────────────────────────────────────────────────

export interface KnowledgeStats {
  total_extractions: number
  total_chains: number
  total_nodes: number
  total_tables: number
  nodes_by_role: Record<string, number>
  top_materials: Array<{ name: string; count: number }>
  top_metrics: Array<{ name: string; count: number }>
}

// ─── Extraction records ───────────────────────────────────────────

export interface KnowledgeExtractionRow {
  id: number
  paper_id: number | null
  doi?: string
  title: string
  source_path?: string
  extracted_at?: string
  section_count?: number
  table_count?: number
  chain_count?: number
  node_count?: number
  project_id?: number
  tags?: string[]
}

export interface KnowledgeExtractionsQuery {
  page?: number
  limit?: number
  q?: string
  tag?: string
}

export interface KnowledgeExtractionsResponse {
  extractions: KnowledgeExtractionRow[]
  total: number
}

/** Full extraction detail — chain records + nodes + optional tables. */
export interface KnowledgeExtractionDetail extends KnowledgeExtractionRow {
  chains?: KnowledgeChain[]
  tables?: Array<{
    caption?: string
    headers: string[]
    rows: string[][]
  }>
}

// ─── Search ────────────────────────────────────────────────────────

export interface KnowledgeSearchQuery {
  q?: string
  material?: string
  metric?: string
  technique?: string
  limit?: number
  min_confidence?: number
  tag?: string
  /** Include chains that the v2 quality gate flagged as diagnostic
   *  (kept in DB for debugging, hidden by default). */
  include_diagnostic?: boolean
  /** Include pre-v2 legacy chains (tagged during DB migration). */
  include_legacy?: boolean
}

export interface KnowledgeChainMatch {
  chain_id: number
  extraction_id: number
  paper_id?: number
  paper_title?: string
  domain_type?: string
  chain_type?: string
  /** v2 extractor pipeline version stamp. Absent on pre-v2 rows. */
  extractor_version?: string
  /** v2 quality gate verdict ('accepted' | 'diagnostic' | 'legacy'). */
  quality?: 'accepted' | 'diagnostic' | 'legacy'
  confidence: number
  context_section?: string
  context_text?: string
  nodes: ChainNode[]
}

/** Response is one of several shapes depending on the search mode the
 *  server picked — material searches return `{type:'material', data}`,
 *  metric/technique/fts searches return `{type, results[]}`, and browse
 *  (no filter) returns `{type:'browse', results[]}`. We keep the union
 *  loose because the server's branches at state_bridge.py:1255-1279
 *  don't share a common envelope. */
export type KnowledgeSearchResponse =
  | {
      type: 'material'
      data: {
        params?: KnowledgeChainMatch[]
        results?: KnowledgeChainMatch[]
        spectra?: unknown[]
        [k: string]: unknown
      }
    }
  | {
      type: 'metric' | 'technique' | 'fts' | 'browse' | 'tag'
      results: KnowledgeChainMatch[]
      tag?: string
    }

// ─── Tags ──────────────────────────────────────────────────────────

export interface KnowledgeTag {
  tag: string
  count: number
}

export type KnowledgeTagsResponse = KnowledgeTag[]

export interface AddKnowledgeTagRequest {
  tag: string
}

export type AddKnowledgeTagResponse =
  | { success: true; tag: string }
  | { success: false; error: string }

export type RemoveKnowledgeTagResponse = {
  success: boolean
  error?: string
}

// ─── Projects ──────────────────────────────────────────────────────

export interface KnowledgeProject {
  id: number
  name: string
  description?: string
  keywords?: string[]
  color?: string
  extraction_count?: number
}

export type KnowledgeProjectsResponse = KnowledgeProject[]

// ─── Extract-selection / save-chains ──────────────────────────────

export interface ExtractSelectionRequest {
  text: string
  paper_id?: number
  page?: number
}

export type ExtractSelectionResponse =
  | { success: true; chains: KnowledgeChain[]; total: number }
  | { success: false; error: string }

export interface SaveChainsRequest {
  paper_id?: number
  chains: Array<{
    nodes: Array<Omit<ChainNode, 'id' | 'chain_id'>>
    confidence?: number
    domain_type?: string
    chain_type?: string
    context_text?: string
    context_section?: string
  }>
  /** Stamp written onto each chain and used by the quality gate. When
   *  absent, saveChains behaves as a generic pass-through (no gate,
   *  chains written as `quality='legacy'`). */
  extractor_version?: string
  /** Forces chains to at least this quality level after the evaluator
   *  verdict. `'diagnostic'` demotes accepted chains (used for heuristic
   *  fallback output, which is never trusted as first-class). */
  quality_floor?: 'diagnostic' | 'legacy'
}

export interface SaveChainsRejectedDetail {
  reasons: string[]
  preview: string
}

export type SaveChainsResponse =
  | {
      success: true
      extraction_id: number
      chain_ids: number[]
      count: number
      /** Breakdown by v2 quality-gate verdict. Present when
       *  `extractor_version` was supplied; otherwise treat as
       *  `accepted === count` and `diagnostic === rejected === 0`. */
      accepted?: number
      diagnostic?: number
      rejected?: number
      rejected_details?: SaveChainsRejectedDetail[]
    }
  | { success: false; error: string }

// ─── Visualization aggregates ─────────────────────────────────────

export interface MetricDistributionGroup {
  name: string
  values: number[]
  count?: number
}

export interface MetricDistributionResponse {
  metric: string
  groups: MetricDistributionGroup[]
}

export interface HeatmapResponse {
  materials: string[]
  metrics: string[]
  /** 2-D array indexed as [material_idx][metric_idx]; nullable per cell. */
  data: Array<Array<number | null>>
}

export interface ExtractionTimelineResponse {
  dates: string[]
  chains: number[]
  nodes: number[]
  papers: number[]
}

export interface PeaksByTechniqueEntry {
  paper_id?: number
  paper_title?: string
  peaks: Array<{
    position: number
    intensity?: number
    label?: string
  }>
}

export interface PeaksByTechniqueResponse {
  technique: string
  entries: PeaksByTechniqueEntry[]
}

export interface VariableListEntry {
  name: string
  role?: string
  unit?: string
  examples?: Array<string | number>
  count?: number
}

export interface VariableListResponse {
  variables: VariableListEntry[]
}

// ─── Compare materials ─────────────────────────────────────────────

export interface CompareMaterialsRequest {
  materials: string[]
  metrics?: string[]
}

export interface CompareMaterialsResponse {
  materials: string[]
  metrics: string[]
  /** Matrix of { value, unit, chain_id, paper_id } per (material, metric). */
  data: Array<
    Array<{
      value?: number | string
      unit?: string
      chain_id?: number
      paper_id?: number
    } | null>
  >
  /** Optional heatmap slice for visualization. */
  heatmap_data?: HeatmapResponse
}

// ─── Paper-grouped knowledge ──────────────────────────────────────

export interface KnowledgePaperGroupRow {
  paper_id?: number
  title?: string
  doi?: string
  materials: string[]
  metrics: Array<{ name: string; value?: number | string; unit?: string }>
  chain_count: number
}

export type KnowledgePapersResponse = KnowledgePaperGroupRow[]
