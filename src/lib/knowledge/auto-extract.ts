// Auto-extract knowledge chains from library papers.
//
// Bridges the library (PDF → full text) and the knowledge DB (chains →
// IndexedDB). Two entry points:
//
//   extractPaperToKnowledge(paperId)  — single paper, called after import
//   extractAllPapersToKnowledge()     — batch, called from UI "Sync" button
//
// Pipeline (ported from lattice-cli/tools/paper_extract.py):
//   1. Read PDF → full text + sections
//   2. PageIndex: build hierarchical tree from sections (deterministic,
//      zero-cost), ask the LLM to pick the data-rich nodes
//   3. Run four-role chain extraction on the selected nodes — either
//      batched in one call (when the combined text fits in budget) or
//      per-node (when sections are individually large)
//   4. Validate + dedupe + save to IndexedDB
//
// Falls back to full-text extraction if PageIndex can't find any
// structured sections (e.g., scanned PDFs where pdfplumber only gives
// back flat text).

import { localProLibrary } from '../local-pro-library'
import { localProKnowledge } from '../local-pro-knowledge'
import type { SaveChainsRequest } from '../../types/knowledge-api'
import type { PaperReadSection } from '../../types/library-api'
import { log } from '../logger'
import { CURRENT_EXTRACTOR_VERSION } from './extractor-version'
import {
  extractChainsFromSections,
  extractChainsFromText,
  type ExtractedChain,
  type TextSection,
} from './llm-extract'
import {
  buildTree,
  createNodeMap,
  resolveSections,
  selectDataNodes,
  type SelectedDataNode,
} from './page-index'

export interface ExtractResult {
  paperId: number
  success: boolean
  /** Number of accepted chains written to the knowledge DB. Diagnostic
   *  and rejected chains are reported separately so the UI can
   *  distinguish "LLM returned weak data" from "save path broke". */
  chainCount: number
  accepted?: number
  diagnostic?: number
  rejected?: number
  /** True when chains came from the heuristic fallback rather than the
   *  LLM. Such chains are always forced to `quality='diagnostic'`. */
  fromHeuristic?: boolean
  stage?: 'read' | 'select' | 'extract' | 'save' | 'done'
  error?: string
}

export interface BatchExtractProgress {
  total: number
  done: number
  results: ExtractResult[]
}

const MIN_FULL_TEXT_LEN = 200
const BATCH_CHAR_BUDGET = 12_000

function toTextSection(n: SelectedDataNode): TextSection {
  return { title: n.title, content: n.content }
}

function paperSectionToText(s: PaperReadSection): TextSection {
  return { title: s.title, content: s.content, level: s.level }
}

/** LLM extraction treats any chain with confidence ≤ 0.35 as heuristic
 *  output (see llm-extract.ts:heuristicChainsFromText). The auto-extract
 *  driver uses this threshold to force heuristic output to
 *  `quality='diagnostic'` regardless of what the evaluator thinks. */
const HEURISTIC_CONFIDENCE_THRESHOLD = 0.35

function chainsLookHeuristic(chains: ExtractedChain[]): boolean {
  if (chains.length === 0) return false
  return chains.every((c) => c.confidence <= HEURISTIC_CONFIDENCE_THRESHOLD)
}

async function extractChainsViaPageIndex(
  paperId: number,
  sections: PaperReadSection[],
  fullText: string,
): Promise<ExtractedChain[] | null> {
  const resolved = resolveSections(sections, fullText)
  log.info(
    `PageIndex: resolved ${resolved.length} sections for paper ${paperId}`,
    {
      source: 'knowledge',
      type: 'unknown',
      detail: {
        stage: 'resolve_sections',
        paperId,
        rawSectionCount: sections.length,
        resolvedSectionCount: resolved.length,
        rawTitles: sections.slice(0, 3).map((s) => s.title),
        resolvedTitles: resolved.slice(0, 10).map((s) => s.title),
        fullTextLen: fullText.length,
      },
    },
  )
  if (resolved.length === 0) return null

  const tree = buildTree(resolved)
  const nodeMap = createNodeMap(tree)
  if (nodeMap.size === 0) return null

  // One LLM call to pick the data-rich sections.
  const selected = await selectDataNodes(tree, nodeMap)
  if (selected.length === 0) {
    log.info(`PageIndex selected no sections for paper ${paperId}`, {
      source: 'knowledge',
      type: 'unknown',
      detail: { stage: 'select_data_nodes', paperId, sectionCount: nodeMap.size },
    })
    return null
  }

  // Chain extraction from the selected nodes. Batch when they fit;
  // otherwise extract per-section.
  const totalLen = selected.reduce((sum, n) => sum + n.content.length, 0)
  if (totalLen <= BATCH_CHAR_BUDGET) {
    const batched = await extractChainsFromSections(selected.map(toTextSection))
    if (!batched.success) {
      log.error('Batched chain extraction failed', {
        source: 'knowledge',
        type: 'http',
        detail: { paperId, stage: 'extract', error: batched.error },
      })
      return null
    }
    return batched.chains
  }

  const all: ExtractedChain[] = []
  for (const node of selected) {
    const result = await extractChainsFromText(node.content, node.title)
    if (result.success) {
      all.push(...result.chains)
    } else {
      log.warn(`Per-section extraction failed for "${node.title}"`, {
        source: 'knowledge',
        type: 'http',
        detail: { paperId, node_id: node.node_id, error: result.error },
      })
    }
  }
  return all
}

export async function extractPaperToKnowledge(
  paperId: number,
): Promise<ExtractResult> {
  // Fail-safe diagnostic — prints to DevTools Console regardless of our
  // log store plumbing. If you don't see this line after clicking
  // Extract, HMR has served a stale module and you need a hard refresh.
  // eslint-disable-next-line no-console
  console.log(
    `%c[auto-extract] ENTER extractPaperToKnowledge(${paperId})`,
    'background:#fef3c7;color:#92400e;padding:2px 6px;border-radius:3px',
  )
  log.info(`Chain extraction starting for paper ${paperId}`, {
    source: 'knowledge',
    type: 'unknown',
    detail: { stage: 'start', paperId },
  })

  // ─── 1. Read paper ─────────────────────────────────────────────
  const read = await localProLibrary.readPaper(paperId)
  if (!read.success) {
    log.error('PDF read failed', {
      source: 'knowledge',
      type: 'not_found',
      detail: { stage: 'read', paperId, error: read.error },
    })
    return {
      paperId,
      success: false,
      chainCount: 0,
      stage: 'read',
      error: read.error,
    }
  }
  const fullText = read.full_text ?? ''
  log.info(
    `PDF read OK: ${fullText.length} chars, ${read.sections?.length ?? 0} sections`,
    {
      source: 'knowledge',
      type: 'unknown',
      detail: {
        stage: 'read',
        paperId,
        fullTextLen: fullText.length,
        sectionCount: read.sections?.length ?? 0,
      },
    },
  )
  if (fullText.trim().length < MIN_FULL_TEXT_LEN) {
    log.warn(`PDF text too short (${fullText.length} chars)`, {
      source: 'knowledge',
      type: 'validation',
      detail: { stage: 'read', paperId, fullTextLen: fullText.length },
    })
    return { paperId, success: true, chainCount: 0, stage: 'read' }
  }

  // ─── 2-3. PageIndex → chain extraction ──────────────────────────
  let chains: ExtractedChain[] | null = null
  try {
    chains = await extractChainsViaPageIndex(
      paperId,
      read.sections ?? [],
      fullText,
    )
  } catch (err) {
    log.exception(err, {
      source: 'knowledge',
      detail: { paperId, stage: 'page_index' },
    })
  }

  // ─── Fallback: flat full-text extraction ────────────────────────
  if (!chains || chains.length === 0) {
    const fallback = await extractChainsFromText(fullText)
    if (!fallback.success) {
      log.error('Fallback chain extraction failed', {
        source: 'knowledge',
        type: 'http',
        detail: { paperId, stage: 'extract_fallback', error: fallback.error },
      })
      return {
        paperId,
        success: false,
        chainCount: 0,
        stage: 'extract',
        error: fallback.error ?? 'LLM extraction failed',
      }
    }
    chains = fallback.chains
  }

  if (chains.length === 0) {
    // eslint-disable-next-line no-console
    console.log(
      `%c[auto-extract] zero chains for paper ${paperId} (stage=extract)`,
      'background:#fee2e2;color:#991b1b;padding:2px 6px;border-radius:3px',
    )
    log.warn(`LLM returned no chains for paper ${paperId}`, {
      source: 'knowledge',
      type: 'unknown',
      detail: { paperId, stage: 'extract', sections: read.sections?.length ?? 0 },
    })
    return { paperId, success: true, chainCount: 0, stage: 'extract' }
  }

  // ─── 4. Save with v2 quality gate ───────────────────────────────
  const fromHeuristic = chainsLookHeuristic(chains)
  const saveReq: SaveChainsRequest = {
    paper_id: paperId,
    extractor_version: CURRENT_EXTRACTOR_VERSION,
    // Heuristic output is never trusted as first-class, even when the
    // evaluator happens to bless it. Floor its quality to diagnostic.
    quality_floor: fromHeuristic ? 'diagnostic' : undefined,
    chains: chains.map((c) => ({
      nodes: c.nodes.map((n, i) => ({
        ordinal: i,
        role: n.role,
        name: n.name,
        value: n.value ?? undefined,
        value_numeric:
          n.value != null ? parseFloat(n.value) || undefined : undefined,
        unit: n.unit ?? undefined,
      })),
      confidence: c.confidence,
      domain_type: c.domain_type,
      chain_type:
        c.confidence <= HEURISTIC_CONFIDENCE_THRESHOLD
          ? 'heuristic_fallback'
          : 'llm_auto',
      context_text: c.context_text,
      context_section: c.context_section,
    })),
  }

  const saveRes = await localProKnowledge.saveChains(saveReq)
  if (!saveRes.success) {
    log.error('Failed to save chains to IndexedDB', {
      source: 'knowledge',
      type: 'runtime',
      detail: { paperId, chainCount: chains.length, stage: 'save' },
    })
    return {
      paperId,
      success: false,
      chainCount: 0,
      stage: 'save',
      error: 'Failed to save chains',
    }
  }

  const accepted = saveRes.accepted ?? saveRes.count
  const diagnostic = saveRes.diagnostic ?? 0
  const rejected = saveRes.rejected ?? 0

  // ─── 5. Surface the extraction summary ─────────────────────────
  // Level flips to `warn` when nothing passed the quality gate so the
  // UI's "auto-open log on failure" hook fires and the user immediately
  // sees why the paper produced no accepted chains.
  const summaryMessage =
    accepted === 0
      ? `Paper ${paperId} produced no chains passing the quality gate (diagnostic=${diagnostic}, rejected=${rejected}) — LLM output was low-signal`
      : `Extraction summary paper=${paperId}: accepted=${accepted} diagnostic=${diagnostic} rejected=${rejected}`
  log[accepted === 0 ? 'warn' : 'info'](summaryMessage, {
    source: 'knowledge',
    type: 'unknown',
    detail: {
      stage: 'extraction-summary',
      paperId,
      extractionId: saveRes.extraction_id,
      accepted,
      diagnostic,
      rejected,
      fromHeuristic,
      rejectedDetails: (saveRes.rejected_details ?? []).slice(0, 10),
    },
  })

  return {
    paperId,
    success: true,
    chainCount: accepted,
    accepted,
    diagnostic,
    rejected,
    fromHeuristic,
    stage: 'done',
  }
}

export async function extractAllPapersToKnowledge(
  onProgress?: (p: BatchExtractProgress) => void,
): Promise<BatchExtractProgress> {
  const papersRes = await localProLibrary.listPapers({ limit: 9999 })
  const papers = papersRes.papers.filter((p) => p.pdf_path)
  const progress: BatchExtractProgress = {
    total: papers.length,
    done: 0,
    results: [],
  }

  for (const paper of papers) {
    const result = await extractPaperToKnowledge(paper.id)
    progress.done += 1
    progress.results.push(result)
    onProgress?.({ ...progress, results: [...progress.results] })
  }

  return progress
}

// Suppress unused-var warning from the helper we export for clarity
// (paperSectionToText is kept in case callers want to reuse the mapping
// — safer than inlining the transform at every call site).
void paperSectionToText
