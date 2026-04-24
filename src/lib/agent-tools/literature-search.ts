// `literature_search` — real literature retrieval for the research flow.
//
// Ports the CLI `_search_papers` entry point (OpenAlex + arXiv in
// parallel, dedup by DOI/title, cited-count-descending rank) to an
// agent-callable tool. The actual HTTPS happens in the Electron main
// process; this module only forwards the IPC and projects the result
// back to the LLM in a tight, JSON-friendly shape.
//
// Usage contract (documented in the `description` field for the LLM):
//
//   - Call this BEFORE research_draft_section when you need grounded
//     citations. The returned rows have real DOIs / URLs and can be
//     quoted directly in the draft.
//   - Prefer a focused query (3-8 keywords). Vague queries come back
//     noisy; the model should refine its plan, then search.
//   - When no citations are needed (e.g. a "snapshot" section that only
//     repeats background knowledge the user already gave you), skip
//     this — each search is a real HTTPS round-trip.
//
// The tool itself is read-only; failure (rate limit / network down)
// does NOT throw — the orchestrator still gets a structured result the
// LLM can inspect and recover from.

import type { LocalTool } from '../../types/agent-tool'
import type {
  LiteratureSearchResultPayload,
  PaperSearchResultPayload,
} from '../../types/electron'

interface Input {
  query: string
  /** Per-source cap (1-50, default 10). Combined results are deduplicated,
   *  then truncated to this value — small is usually enough. */
  limit?: number
}

interface Output {
  ok: true
  query: string
  count: number
  durationMs: number
  /** Trimmed-abstract rows suitable for an LLM prompt context window.
   *  Callers that need the raw data should use `window.electronAPI.literatureSearch` directly. */
  results: Array<{
    id: string
    title: string
    authors: string
    year: string
    venue: string
    doi: string
    url: string
    source: 'openalex' | 'arxiv'
    citedByCount?: number
    abstract: string
  }>
  /** Per-source status surfaces partial failure so the LLM can decide
   *  whether to retry with a different query or proceed with what it
   *  got. */
  diagnostics: {
    openalex: { ok: boolean; count: number; error?: string }
    arxiv: { ok: boolean; count: number; error?: string }
  }
}

interface ErrorOutput {
  ok: false
  error: string
}

// Bound the abstract length the LLM sees. Raw abstracts can be 1-2 KB
// each; at `limit=20` that's 40 KB piped into every tool_result, which
// blows up prompt budgets fast. 600 chars preserves the first-paragraph
// gist without hurting relevance judgement.
const ABSTRACT_CHAR_BUDGET = 600

function trimAbstract(text: string): string {
  const clean = (text || '').trim()
  if (clean.length <= ABSTRACT_CHAR_BUDGET) return clean
  return `${clean.slice(0, ABSTRACT_CHAR_BUDGET - 1)}…`
}

export const literatureSearchTool: LocalTool<Input, Output | ErrorOutput> = {
  name: 'literature_search',
  description:
    'Search OpenAlex + arXiv for real papers matching a query. Returns title / authors / year / DOI / URL / abstract rows the agent can cite in a research draft. Prefer a focused 3-8 keyword query; call BEFORE research_draft_section when a section needs external evidence. Runs in parallel against both sources and dedupes by DOI/title. Read-only, safe to call; cost is one HTTPS round-trip per source.',
  // Retrieval tool — silent by default. The rich Phase-3b preview
  // (LiteratureSearchCardPreview) still renders when the user expands
  // the audit chip.
  cardMode: 'silent',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Focused keyword query. Example: "Fe-doped BaTiO3 band gap photocatalysis". Avoid full-sentence prompts.',
      },
      limit: {
        type: 'number',
        description:
          'Max rows to return after dedup (1-50, default 10). Bigger = more evidence but longer prompt context.',
      },
    },
    required: ['query'],
  },
  async execute(input): Promise<Output | ErrorOutput> {
    const query = (input?.query ?? '').trim()
    if (!query) return { ok: false, error: 'query is empty' }

    const api = window.electronAPI
    if (!api?.literatureSearch) {
      return {
        ok: false,
        error:
          'literature_search requires the Electron desktop shell — run the app via `npm run electron:dev`, not the browser-only `npm run dev`.',
      }
    }

    const limit =
      typeof input?.limit === 'number' && Number.isFinite(input.limit)
        ? Math.max(1, Math.min(50, Math.round(input.limit)))
        : 10

    let result: LiteratureSearchResultPayload
    try {
      result = await api.literatureSearch({ query, limit })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: `IPC error: ${message}` }
    }

    if (!result.success) {
      return { ok: false, error: result.error }
    }

    return {
      ok: true,
      query: result.query,
      count: result.results.length,
      durationMs: result.durationMs,
      results: result.results.map(projectForLlm),
      diagnostics: result.diagnostics,
    }
  },
}

function projectForLlm(
  row: PaperSearchResultPayload,
): Output['results'][number] {
  return {
    id: row.id,
    title: row.title,
    authors: row.authors,
    year: row.year,
    venue: row.venue,
    doi: row.doi,
    url: row.url,
    source: row.source,
    citedByCount: row.citedByCount,
    abstract: trimAbstract(row.abstract),
  }
}
