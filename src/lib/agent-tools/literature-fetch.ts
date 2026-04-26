// `literature_fetch` — search, download, and import papers into the Library.
//
// Closes the gap between `literature_search` (metadata only) and
// `hypothesis_gather_evidence` (needs PDF full text for RAG). This tool:
//   1. Searches OpenAlex + arXiv via the existing `literatureSearch` IPC
//   2. Resolves open-access PDF URLs (OpenAlex OA field, arXiv, Unpaywall)
//   3. Downloads PDFs into the Library via `libraryDownloadAndImportPdf`
//   4. Falls back to metadata-only import for papers without OA PDF
//
// After this tool runs, `hypothesis_gather_evidence` can RAG over the
// newly imported papers via `paper.read_pdf` + `rag.retrieve`.

import type { LocalTool } from '../../types/agent-tool'
import type {
  LiteratureSearchResultPayload,
  PaperSearchResultPayload,
  LibraryAddPaperResultPayload,
  LibraryDownloadAndImportPdfResultPayload,
} from '../../types/electron'
import { callWorker } from '../worker-client'

interface Input {
  /** Search keywords (3-8 words recommended). */
  query: string
  /** Max papers to download/import. Default 3, max 5. */
  maxPapers?: number
  /** Skip search, directly fetch these DOIs (comma-separated string). */
  dois?: string
}

interface FetchedPaper {
  paperId: number
  title: string
  doi: string
  hasPdf: boolean
  source: 'openalex' | 'arxiv' | 'semantic_scholar' | 'doi'
}

interface Output {
  ok: true
  query: string
  fetched: FetchedPaper[]
  totalWithPdf: number
  totalMetadataOnly: number
  nextSteps: string
}

interface ErrorOutput {
  ok: false
  error: string
}

const UNPAYWALL_EMAIL = 'lattice-app@local'
const UNPAYWALL_TIMEOUT_MS = 8_000

export const literatureFetchTool: LocalTool<Input, Output | ErrorOutput> = {
  name: 'literature_fetch',
  description:
    'Search OpenAlex + arXiv + Semantic Scholar for papers, download open-access PDFs, and import them '
    + 'into the local Library with full metadata. After import, papers are available for '
    + 'page-indexed RAG via hypothesis_gather_evidence. Prefer focused 3-8 keyword queries. '
    + 'Alternatively, pass a list of DOIs to fetch specific papers.',
  cardMode: 'info',
  trustLevel: 'localWrite',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Focused keyword query for literature search.',
      },
      maxPapers: {
        type: 'number',
        description: 'Max papers to import (1-5). Default 3.',
      },
      dois: {
        type: 'string',
        description:
          'Comma-separated DOIs to fetch directly (skips search). E.g. "10.1234/abc,10.5678/def".',
      },
    },
    required: ['query'],
  },

  async execute(input, ctx): Promise<Output | ErrorOutput> {
    if (ctx.signal.aborted) throw new Error('Aborted before start')

    const query = (input?.query ?? '').trim()
    if (!query) return { ok: false, error: 'query is required' }

    const maxPapers = Math.max(1, Math.min(5,
      typeof input.maxPapers === 'number' ? input.maxPapers : 3,
    ))

    const api = window.electronAPI
    if (!api?.literatureSearch || !api?.libraryDownloadAndImportPdf || !api?.libraryAddPaper) {
      return {
        ok: false,
        error:
          'literature_fetch requires the Electron desktop shell — '
          + 'run via `npm run electron:dev`.',
      }
    }

    // ── Step 1: Get paper candidates ──────────────────────────────
    let candidates: PaperSearchResultPayload[]

    const doisInput = typeof input.dois === 'string' ? input.dois.trim() : ''
    if (doisInput) {
      // Direct DOI mode — skip search, build minimal candidates
      const dois = doisInput.split(',').map((d) => d.trim()).filter(Boolean)
      candidates = dois.map((doi) => ({
        id: `doi:${doi}`,
        title: '',
        abstract: '',
        authors: '',
        year: '',
        doi,
        url: `https://doi.org/${doi}`,
        source: 'openalex' as const,
        venue: '',
      }))
    } else {
      // Search mode
      let searchResult: LiteratureSearchResultPayload
      try {
        searchResult = await api.literatureSearch({
          query,
          limit: maxPapers * 3,
        })
      } catch (err) {
        return {
          ok: false,
          error: `Literature search failed: ${err instanceof Error ? err.message : String(err)}`,
        }
      }
      if (!searchResult.success) {
        return { ok: false, error: searchResult.error }
      }
      candidates = searchResult.results
    }

    if (candidates.length === 0) {
      return { ok: false, error: `No papers found for query: ${query}` }
    }

    ctx.reportProgress?.({
      kind: 'status',
      message: `Found ${candidates.length} candidates, resolving OA PDFs...`,
    })

    // ── Step 2: Resolve OA PDF URLs ───────────────────────────────
    // Priority: existing oaPdfUrl > Unpaywall lookup > skip
    const resolved: Array<PaperSearchResultPayload & { resolvedPdfUrl?: string }> = []

    for (const paper of candidates.slice(0, maxPapers * 2)) {
      if (ctx.signal.aborted) throw new Error('Aborted during URL resolution')

      let pdfUrl = paper.oaPdfUrl

      // Try Unpaywall for papers with DOI but no OA URL
      if (!pdfUrl && paper.doi) {
        pdfUrl = await resolveUnpaywall(paper.doi)
      }

      // arXiv fallback: derive PDF from abs URL
      if (!pdfUrl && paper.source === 'arxiv' && paper.url) {
        const arxivMatch = paper.url.match(/arxiv\.org\/abs\/(.+)/)
        if (arxivMatch) {
          pdfUrl = `https://arxiv.org/pdf/${arxivMatch[1]}.pdf`
        }
      }

      resolved.push({ ...paper, resolvedPdfUrl: pdfUrl })
    }

    // Sort: papers with PDF first
    resolved.sort((a, b) => {
      if (a.resolvedPdfUrl && !b.resolvedPdfUrl) return -1
      if (!a.resolvedPdfUrl && b.resolvedPdfUrl) return 1
      return 0
    })

    // ── Step 3: Download + Import ─────────────────────────────────
    const fetched: FetchedPaper[] = []
    let totalWithPdf = 0
    let totalMetadataOnly = 0

    for (const paper of resolved.slice(0, maxPapers)) {
      if (ctx.signal.aborted) throw new Error('Aborted during import')

      ctx.reportProgress?.({
        kind: 'status',
        message: `Importing: ${paper.title.slice(0, 60) || paper.doi || '(unknown)'}...`,
      })

      if (paper.resolvedPdfUrl) {
        // Download PDF + import with metadata
        try {
          const result: LibraryDownloadAndImportPdfResultPayload =
            await api.libraryDownloadAndImportPdf({
              pdfUrl: paper.resolvedPdfUrl,
              title: paper.title || `DOI: ${paper.doi}`,
              authors: paper.authors || 'Unknown',
              year: paper.year,
              doi: paper.doi,
              url: paper.url,
              journal: paper.venue,
              abstract: paper.abstract,
              tags: ['auto-fetch'],
            })
          if (result.success) {
            fetched.push({
              paperId: result.id,
              title: paper.title || paper.doi,
              doi: paper.doi,
              hasPdf: true,
              source: paper.source,
            })
            totalWithPdf++
            continue
          }
        } catch {
          // PDF download failed — fall through to metadata-only
        }
      }

      // Metadata-only import
      if (paper.title || paper.doi) {
        try {
          const result: LibraryAddPaperResultPayload =
            await api.libraryAddPaper({
              title: paper.title || `DOI: ${paper.doi}`,
              authors: paper.authors || 'Unknown',
              year: paper.year,
              doi: paper.doi,
              url: paper.url,
              journal: paper.venue,
              abstract: paper.abstract,
              tags: ['auto-fetch'],
            })
          if (result.success) {
            fetched.push({
              paperId: result.id,
              title: paper.title || paper.doi,
              doi: paper.doi,
              hasPdf: false,
              source: paper.source,
            })
            totalMetadataOnly++
          }
        } catch {
          // Skip silently
        }
      }
    }

    if (fetched.length === 0) {
      return { ok: false, error: 'Failed to import any papers.' }
    }

    return {
      ok: true,
      query,
      fetched,
      totalWithPdf,
      totalMetadataOnly,
      nextSteps:
        `Imported ${fetched.length} papers (${totalWithPdf} with PDF, ${totalMetadataOnly} metadata-only). `
        + (totalWithPdf > 0
          ? 'Papers with PDFs are now available for RAG via hypothesis_gather_evidence.'
          : 'No OA PDFs were available. Consider manually adding PDFs to the Library.'),
    }
  },
}

async function resolveUnpaywall(doi: string): Promise<string | undefined> {
  try {
    const url = `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${UNPAYWALL_EMAIL}`
    const result = await callWorker<{
      success: boolean
      data?: { body: string }
    }>('web.fetch', {
      url,
      max_chars: 10_000,
      timeout: Math.floor(UNPAYWALL_TIMEOUT_MS / 1000),
    })

    if (!result.ok || !result.value.success) return undefined

    const body = result.value.data?.body
    if (!body) return undefined

    try {
      const parsed = JSON.parse(body) as Record<string, unknown>
      const bestOa = parsed.best_oa_location as
        | { url_for_pdf?: string }
        | undefined
      const pdfUrl = bestOa?.url_for_pdf
      if (typeof pdfUrl === 'string' && pdfUrl.startsWith('http')) {
        return pdfUrl
      }
    } catch {
      // JSON parse failed
    }
  } catch {
    // Worker call failed
  }
  return undefined
}
