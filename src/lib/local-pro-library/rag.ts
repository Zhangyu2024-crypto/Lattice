// PDF resolution, paper reading, and RAG-style Q&A. All of these either
// trampoline through IPC into the main-process library or delegate to
// the local-pro `paper` / `rag` helpers.
//
// Most of the non-trivial glue (full-text enrichment, alignment of
// per-paper answers to original paper_ids, graceful degradation) lives
// here rather than in callers so the UI surface stays simple.

import { localProPaper } from '../local-pro-paper'
import { localProRag } from '../local-pro-rag'
import type {
  AskMultiRequest,
  AskMultiResponse,
  AskPaperRequest,
  AskPaperResponse,
  PaperReadResponse,
} from '../../types/library-api'
import { electron, IPC_UNAVAILABLE } from './helpers'

export async function pdfUrl(paperId: number): Promise<string | null> {
  const getter = electron()?.libraryGetPaper
  if (getter) {
    const lookup = await getter(paperId)
    if (lookup.error || !lookup.paper?.pdf_path) return null
    return `lattice-pdf://paper/${paperId}`
  }
  const reader = electron()?.libraryReadPdfBytes
  if (!reader) return null
  const result = await reader({ id: paperId })
  if (!result.ok) return null
  const blob = new Blob([result.bytes], { type: 'application/pdf' })
  return URL.createObjectURL(blob)
}

export async function pdfBytes(
  paperId: number,
): Promise<ArrayBuffer | null> {
  const reader = electron()?.libraryReadPdfBytes
  if (!reader) {
    // Keep logging quiet when the IPC simply isn't attached (pure-Vite
    // dev mode, no Electron shell) — callers already treat null as
    // "no PDF available" and fall back cleanly.
    return null
  }
  const result = await reader({ id: paperId })
  if (!result.ok) {
    // Intentionally surface — the UI's "PDF preview unavailable" flow
    // already shows `error.message`, but main-process side issues (e.g.
    // the file was moved on disk) tend to bite silently so a single
    // console.warn here makes them noticeable without spamming.
    console.warn(
      `[localProLibrary.pdfBytes] paper ${paperId}: ${result.error}`,
    )
    return null
  }
  return result.bytes
}

export async function readPaper(id: number): Promise<PaperReadResponse> {
  // The worker needs an absolute PDF path and doesn't know any of the
  // library-side metadata; we look both up via a dedicated IPC (rather
  // than paging the full list) and enrich the response so downstream
  // consumers like askPaper and the PDF viewer get the title / authors
  // / journal they expect.
  const getter = electron()?.libraryGetPaper
  if (!getter) {
    return { success: false, error: IPC_UNAVAILABLE }
  }
  const lookup = await getter(id)
  if (lookup.error) {
    return { success: false, error: lookup.error }
  }
  const row = lookup.paper
  if (!row) {
    return { success: false, error: `paper ${id} not found in library` }
  }
  if (!row.pdf_path) {
    return {
      success: false,
      error:
        'No PDF path on this paper — add one via "Scan directory" or attach a local PDF before extracting full text.',
    }
  }
  const read = await localProPaper.readPaper(id, row.pdf_path)
  if (!read.success) return read
  return {
    ...read,
    title: row.title,
    authors: row.authors,
    year: row.year,
    journal: row.journal,
    doi: row.doi,
  }
}

export async function askPaper(
  id: number,
  req: AskPaperRequest,
): Promise<AskPaperResponse> {
  const read = await readPaper(id)
  if (!read.success) {
    return { success: false, error: read.error }
  }
  return await localProRag.askPaper(id, read.full_text, req.question, {
    title: read.title,
  })
}

export async function askMulti(
  req: AskMultiRequest,
): Promise<AskMultiResponse> {
  // Read every selected paper in input order so the response can carry
  // per-paper entries that line up 1:1 with `req.paper_ids` — the
  // MultiPaperQAModal renders `per_paper[idx]` against
  // `selectedPapers[idx]`, so index drift would attach the wrong
  // summaries to the wrong titles.
  const readResults = await Promise.all(
    req.paper_ids.map(async (paperId) => {
      const read = await readPaper(paperId)
      return { paperId, read }
    }),
  )
  const docs = readResults
    .filter((r) => r.read.success)
    .map((r) => ({
      id: r.paperId,
      // r.read is narrowed here — `success === true`
      title: (r.read as Extract<typeof r.read, { success: true }>).title,
      text: (r.read as Extract<typeof r.read, { success: true }>).full_text,
    }))
  if (docs.length === 0) {
    return {
      success: false,
      error:
        'No selected paper has extractable full text. Attach PDFs via "Scan directory" first.',
    }
  }
  const answer = await localProRag.askMulti(docs, req.question)
  if (!answer.success) return answer
  // Re-project per_paper onto the original paper_ids so failed reads
  // become explicit "could not extract" placeholders at their original
  // slot, not silent omissions.
  const byId = new Map<number, string>()
  answer.per_paper.forEach((entry, idx) => {
    const matchedId = docs[idx]?.id
    if (matchedId !== undefined) byId.set(matchedId, entry)
  })
  const alignedPerPaper = readResults.map((r) => {
    if (r.read.success) {
      return (
        byId.get(r.paperId) ??
        `paper ${r.paperId}: no relevant excerpts retrieved.`
      )
    }
    return `paper ${r.paperId}: could not extract text — ${r.read.error}`
  })
  return {
    success: true,
    answer: answer.answer,
    per_paper: alignedPerPaper,
    paper_count: req.paper_ids.length,
  }
}
