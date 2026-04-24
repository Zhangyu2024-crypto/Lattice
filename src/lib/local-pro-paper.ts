// LocalProPaper — PDF read subset of the library API.
//
// Routes through the repo-local Python worker (`worker/tools/paper.py`):
//
//   • readPaper — pdfplumber per-page text → PaperReadResponse
//
// The former `paperExtractions` / `paperChains` helpers used to back the
// knowledge/chain feature and were removed along with it. `readPaper`
// itself has no knowledge-feature dependency and is kept because paper
// RAG Q&A (askPaper / askMulti) still needs it.
//
// Contract: worker IPC failures throw, mirroring the legacy
// `useLibraryApi` REST client. `{ success: false, error }` payloads from
// the worker are forwarded as-is so callers' branching stays one-for-one.

import { callWorker } from './worker-client'
import type {
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
}
