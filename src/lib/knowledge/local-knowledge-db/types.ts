// Internal row types for the IndexedDB-backed knowledge store.
// These are the on-disk shapes; the public KnowledgeApi types (from
// `src/types/knowledge-api`) are derived from them in the query layer.

import type { ChainNode } from '../../../types/library-api'
import type { ChainQuality } from '../extractor-version'

export interface DbExtraction {
  id: number
  paper_id: number | null
  doi: string
  title: string
  source_path: string
  extracted_at: string
  section_count: number
  table_count: number
  chain_count: number
  node_count: number
  /** Chains that failed the quality gate and were never written. Optional
   *  so pre-v2 rows stay parseable; readers should treat `undefined` as 0. */
  rejected_count?: number
  project_id: number | null
  tags: string[]
}

export interface DbChain {
  id: number
  extraction_id: number
  domain_type: string
  /** Source of the chain: 'llm_auto' | 'heuristic_fallback' | 'heuristic'
   *  | '' (legacy). Orthogonal to `quality` — a heuristic chain can still
   *  be shape-valid, it just won't survive the quality gate as accepted. */
  chain_type: string
  /** Which extractor produced this chain. Defaults to 'v1-legacy' when
   *  missing so pre-v2 rows sort into the legacy pool in the UI. */
  extractor_version: string
  /** Quality gate verdict. 'accepted' = meets current schema bar,
   *  'diagnostic' = kept for debugging (not shown by default),
   *  'legacy' = pre-v2 row (hidden by default until the user opts in). */
  quality: ChainQuality
  context_text: string
  context_section: string
  confidence: number
  nodes: ChainNode[]
}

export interface DbProject {
  id: number
  name: string
  description: string
  keywords: string[]
  color: string
  created_at: string
}
