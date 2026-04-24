// LocalProRag — single- and multi-paper RAG question answering.
// Self-contained Port Plan §P4-ζ.
//
// Architecture: the Python worker runs TF-IDF + cosine retrieval over
// the supplied full text(s); the renderer owns the final synthesis
// step and dispatches it through `sendLlmChat`, which reuses the
// user-configured LLM provider and its IPC key plumbing. This way the
// worker stays dependency-light (sklearn only) and never sees API keys.

import { callWorker } from './worker-client'
import { sendLlmChat } from './llm-chat'
import type {
  AskMultiResponse,
  AskPaperResponse,
  RagSource,
} from '../types/library-api'

interface RetrievedChunk {
  doc_id: number | string
  doc_title: string | null
  chunk_index: number
  char_start: number
  char_end: number
  score: number
  rank: number
  text: string
}

type WorkerRetrieve =
  | {
      success: true
      question: string
      chunks: RetrievedChunk[]
      summary: string
    }
  | { success: false; error: string }

export interface RagDocument {
  id: number | string
  title?: string
  text: string
}

export interface RagOptions {
  top_k?: number
  chunk_size?: number
  chunk_overlap?: number
  /** Override the dialog-mode LLM synthesis and return only the retrieval
   *  result. Useful when the caller wants to inspect chunks first. */
  skipSynthesis?: boolean
}

const DEFAULT_TOP_K = 6
const RETRIEVE_TIMEOUT_MS = 20_000
const EXCERPT_PREVIEW_LIMIT = 200
const PROMPT_CHUNK_CHAR_LIMIT = 1_200
const PROMPT_TOTAL_CHAR_LIMIT = 12_000

function truncate(text: string, limit: number): string {
  if (!text) return ''
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= limit) return trimmed
  return trimmed.slice(0, limit - 1).trimEnd() + '…'
}

interface BudgetedChunks {
  /** The prefix of `chunks` that fit inside `PROMPT_TOTAL_CHAR_LIMIT`.
   *  Downstream `sources` / `per_paper` must derive from this subset,
   *  not the full retrieval, so the UI never advertises support from a
   *  chunk the LLM never saw. */
  kept: RetrievedChunk[]
  /** Pre-rendered prompt context body (blocks joined by blank lines). */
  context: string
}

function applyPromptBudget(chunks: RetrievedChunk[]): BudgetedChunks {
  const kept: RetrievedChunk[] = []
  const parts: string[] = []
  let used = 0
  for (const chunk of chunks) {
    const heading = chunk.doc_title ? chunk.doc_title : `doc ${chunk.doc_id}`
    const body = truncate(chunk.text, PROMPT_CHUNK_CHAR_LIMIT)
    const block = `--- source: ${heading} · chunk #${chunk.chunk_index} · score=${chunk.score.toFixed(3)} ---\n${body}`
    if (used + block.length > PROMPT_TOTAL_CHAR_LIMIT && kept.length > 0) break
    parts.push(block)
    kept.push(chunk)
    used += block.length
  }
  return { kept, context: parts.join('\n\n') }
}

function buildPrompt(question: string, context: string): string {
  return [
    'You are a research assistant answering questions about scientific papers.',
    'Use only the retrieved excerpts below. Cite sources inline as (doc_title · chunk #N).',
    'If the excerpts do not contain the answer, say so plainly instead of guessing.',
    '',
    `Question: ${question}`,
    '',
    'Retrieved excerpts:',
    context,
  ].join('\n')
}

function chunksToSources(chunks: RetrievedChunk[]): RagSource[] {
  return chunks.map((chunk) => {
    const source: RagSource = {
      title: chunk.doc_title ?? undefined,
      excerpt: truncate(chunk.text, EXCERPT_PREVIEW_LIMIT),
    }
    if (typeof chunk.doc_id === 'number') source.paper_id = chunk.doc_id
    return source
  })
}

async function retrieve(
  documents: RagDocument[],
  question: string,
  options: RagOptions | undefined,
): Promise<RetrievedChunk[]> {
  const payload = {
    question,
    documents: documents.map((d) => ({
      id: d.id,
      title: d.title ?? null,
      text: d.text,
    })),
    top_k: options?.top_k ?? DEFAULT_TOP_K,
    chunk_size: options?.chunk_size,
    chunk_overlap: options?.chunk_overlap,
  }
  const result = await callWorker<WorkerRetrieve>(
    'rag.retrieve',
    payload,
    { timeoutMs: RETRIEVE_TIMEOUT_MS },
  )
  if (!result.ok) throw new Error(result.error)
  const value = result.value
  if (!value.success) throw new Error(value.error)
  return value.chunks
}

export const localProRag = {
  /** Ask a question about a single paper. The caller supplies the full
   *  text already (obtained via `localProPaper.readPaper`) — the facade
   *  keeps the worker stateless. */
  async askPaper(
    paperId: number,
    paperText: string,
    question: string,
    options?: RagOptions & { title?: string },
  ): Promise<AskPaperResponse> {
    if (!paperText?.trim()) {
      return {
        success: false,
        error: 'paper full text is empty — extract the PDF first',
      }
    }
    if (!question?.trim()) {
      return { success: false, error: 'question is required' }
    }
    let chunks: RetrievedChunk[]
    try {
      chunks = await retrieve(
        [{ id: paperId, title: options?.title, text: paperText }],
        question,
        options,
      )
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
    const budgeted = applyPromptBudget(chunks)
    if (options?.skipSynthesis) {
      return {
        success: true,
        answer: '',
        sources: chunksToSources(budgeted.kept),
      }
    }

    const reply = await sendLlmChat({
      mode: 'dialog',
      userMessage: buildPrompt(question, budgeted.context),
      transcript: [],
      sessionId: null,
    })
    if (!reply.success) {
      return {
        success: false,
        error: reply.error ?? 'LLM synthesis failed',
      }
    }
    return {
      success: true,
      answer: reply.content,
      sources: chunksToSources(budgeted.kept),
    }
  },

  /** Ask a question across multiple papers. The caller supplies each
   *  paper's already-extracted full text; the facade returns a single
   *  synthesised answer plus one placeholder string per paper to match
   *  the legacy REST shape that the UI consumes. */
  async askMulti(
    documents: RagDocument[],
    question: string,
    options?: RagOptions,
  ): Promise<AskMultiResponse> {
    const docs = documents.filter((d) => d.text?.trim())
    if (docs.length === 0) {
      return {
        success: false,
        error: 'no paper has extractable full text — open each PDF first',
      }
    }
    if (!question?.trim()) {
      return { success: false, error: 'question is required' }
    }
    let chunks: RetrievedChunk[]
    try {
      chunks = await retrieve(docs, question, options)
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }

    const budgeted = applyPromptBudget(chunks)
    const reply = await sendLlmChat({
      mode: 'dialog',
      userMessage: buildPrompt(question, budgeted.context),
      transcript: [],
      sessionId: null,
    })
    if (!reply.success) {
      return {
        success: false,
        error: reply.error ?? 'LLM synthesis failed',
      }
    }
    // `per_paper` reflects only the chunks that made it into the prompt,
    // so UI summaries never advertise contributions from a chunk the LLM
    // never actually saw.
    const perPaperCounts = new Map<string, number>()
    for (const chunk of budgeted.kept) {
      const key = String(chunk.doc_id)
      perPaperCounts.set(key, (perPaperCounts.get(key) ?? 0) + 1)
    }
    const perPaper = docs.map((doc) => {
      const count = perPaperCounts.get(String(doc.id)) ?? 0
      const label = doc.title ?? `doc ${doc.id}`
      return count > 0
        ? `${label}: ${count} excerpt${count === 1 ? '' : 's'} contributed.`
        : `${label}: no relevant excerpts retrieved.`
    })
    return {
      success: true,
      answer: reply.content,
      per_paper: perPaper,
      paper_count: docs.length,
    }
  },
}
