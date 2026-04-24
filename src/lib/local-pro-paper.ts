// LocalProPaper — PDF read / extractions / chains subset of
// `useLibraryApi`. Self-contained Port Plan §P4-ε.
//
// Routes through the repo-local Python worker (worker/tools/paper.py):
//   • readPaper         — pdfplumber per-page text → PaperReadResponse
//   • paperExtractions  — placeholder (empty list from worker)
//   • paperChains       — heuristic process / measurement chain parse
//
// Contract: worker IPC failures throw, mirroring the legacy
// `useLibraryApi` REST client. `{ success: false, error }` payloads from
// the worker are forwarded as-is so callers' branching stays one-for-one.

import { callWorker } from './worker-client'
import type {
  ChainNode,
  KnowledgeChain,
  PaperChainsResponse,
  PaperExtractionSummary,
  PaperExtractionsResponse,
  PaperReadResponse,
  PaperReadSection,
} from '../types/library-api'

interface WorkerPage {
  page_number: number
  text: string
  char_count: number
}

type WorkerReadPdf =
  | {
      success: true
      paper_id?: number | string
      n_pages: number
      pages: WorkerPage[]
      full_text: string
      full_text_chars: number
    }
  | { success: false; error: string }

interface WorkerChainNode {
  ordinal: number
  role: string
  name: string
  line?: string
}

interface WorkerChain {
  id: number
  nodes: WorkerChainNode[]
}

type WorkerChains =
  | { success: true; paper_id?: number | string; chains: WorkerChain[] }
  | { success: false; error: string }

type WorkerExtractions =
  | {
      success: true
      paper_id?: number | string
      extractions: PaperExtractionSummary[]
    }
  | { success: false; error: string }

function pagesToSections(pages: WorkerPage[]): PaperReadSection[] {
  // One section per page keeps the worker output cheap to consume and
  // matches what the renderer's "Show full text" + whole-paper-chunker
  // paths expect — they already iterate sections and fall back to
  // full_text when the array is empty.
  return pages.map((p) => ({
    title: `Page ${p.page_number}`,
    level: 1,
    content: p.text,
  }))
}

function normaliseChain(chain: WorkerChain): KnowledgeChain {
  const nodes: ChainNode[] = chain.nodes.map((n) => {
    const role = n.role as ChainNode['role']
    const base: ChainNode = {
      chain_id: chain.id,
      ordinal: n.ordinal,
      role,
      name: n.name,
    }
    if (n.line) base.metadata = { line: n.line }
    return base
  })
  return {
    id: chain.id,
    chain_type: 'heuristic',
    nodes,
  }
}

export const localProPaper = {
  /** Extract text from a PDF on disk. Throws when the worker IPC itself
   *  fails; `{success:false}` payloads pass through so callers keep
   *  their existing branching. */
  async readPaper(
    paperId: number,
    pdfPath: string,
  ): Promise<PaperReadResponse> {
    const result = await callWorker<WorkerReadPdf>(
      'paper.read_pdf',
      { paper_id: paperId, path: pdfPath },
      { timeoutMs: 60_000 },
    )
    if (!result.ok) {
      throw new Error(result.error)
    }
    const value = result.value
    if (!value.success) {
      return { success: false, error: value.error }
    }
    return {
      success: true,
      paper_id: typeof value.paper_id === 'number' ? value.paper_id : paperId,
      page_count: value.n_pages,
      sections: pagesToSections(value.pages),
      full_text: value.full_text,
      source: 'local_pdf',
    }
  },

  /** Placeholder pass-through — returns an empty list until a local LLM
   *  extraction pipeline lands. */
  async paperExtractions(
    paperId: number,
  ): Promise<PaperExtractionsResponse> {
    const result = await callWorker<WorkerExtractions>(
      'paper.extractions',
      { paper_id: paperId },
      { timeoutMs: 10_000 },
    )
    if (!result.ok) {
      throw new Error(result.error)
    }
    const value = result.value
    if (!value.success) {
      throw new Error(value.error)
    }
    const extractions = value.extractions ?? []
    return {
      success: true,
      extractions,
      total: extractions.length,
    }
  },

  /** Heuristic chain parse. Caller passes the full text (obtained via
   *  `readPaper`); without text we return an empty chain list rather
   *  than re-reading the PDF here — the renderer already orchestrates
   *  read → chain separately. */
  async paperChains(
    paperId: number,
    text?: string,
  ): Promise<PaperChainsResponse> {
    if (!text || !text.trim()) {
      return { success: true, chains: [], total: 0 }
    }
    const result = await callWorker<WorkerChains>(
      'paper.extract_chains',
      { paper_id: paperId, text },
      { timeoutMs: 15_000 },
    )
    if (!result.ok) {
      throw new Error(result.error)
    }
    const value = result.value
    if (!value.success) {
      throw new Error(value.error)
    }
    const chains = (value.chains ?? []).map(normaliseChain)
    return { success: true, chains, total: chains.length }
  },
}
