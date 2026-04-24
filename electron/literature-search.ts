// Literature search — ports lattice-cli's `_search_openalex` /
// `_search_arxiv` / `_search_papers` (`tools/survey_pipeline.py`) to the
// Electron main process so the renderer-side agent runtime can ground
// research drafts in real publication metadata instead of LLM-only
// "knowledge". Runs in the main process to bypass the renderer CSP.
//
// Intentionally narrow scope (MVP):
//   - OpenAlex: https://api.openalex.org/works
//   - arXiv Atom API: https://export.arxiv.org/api/query
//   - No Semantic Scholar (rate-limited free tier) and no local FAISS
//     RAG. Those are separate follow-ups once we have the UX loop right.
//
// Both sources are queried in parallel; a failure on one side degrades
// gracefully to whatever the other returned. Results are deduplicated by
// (normalized title || DOI), then capped at the caller-requested limit.
//
// No third-party XML parser: the arXiv Atom feed is shallow and stable,
// so a targeted regex pass (see `parseArxivFeed`) is both zero-dep and
// resilient enough for this call site. The Python CLI uses Python's
// built-in `xml.etree`, which we don't have a Node equivalent of without
// adding jsdom / fast-xml-parser.

export interface PaperSearchResult {
  /** Stable identifier for this result. Prefers DOI; falls back to the
   *  source-specific URL (arXiv abs) when no DOI is known. Never empty. */
  id: string
  title: string
  abstract: string
  /** Comma-separated author list, capped at the first five. Matches the
   *  CLI shape so the downstream citation-key helpers stay interchangeable. */
  authors: string
  /** Publication year as a 4-digit string, or '' when unknown. */
  year: string
  /** Bare DOI without the `https://doi.org/` prefix; '' when unknown. */
  doi: string
  /** Fully-resolved URL users can click — `https://doi.org/...` for
   *  OpenAlex, the arxiv `abs` URL for arXiv results, or '' when both
   *  are unknown. */
  url: string
  /** Source adapter that produced the row. Useful for the UI to badge
   *  results and for the agent prompt to weight recency vs peer review. */
  source: 'openalex' | 'arxiv'
  /** Journal / venue name when the source reported one. */
  venue: string
  /** Absolute citation count as reported by the source (OpenAlex always
   *  exposes this; arXiv does not). Undefined when unknown. */
  citedByCount?: number
  /** Open-access PDF URL when the source reports one. */
  oaPdfUrl?: string
}

export interface LiteratureSearchRequest {
  query: string
  /** Per-source cap (OpenAlex + arXiv each fetch up to this many, then
   *  the combined list is deduplicated and truncated to the same cap). */
  limit?: number
  /** Override per-source timeout. Defaults to 20s, clamped to [5, 60]. */
  timeoutMs?: number
  /** Opaque contact email added as OpenAlex `mailto` — OpenAlex's "polite
   *  pool" raises rate limits. Safe to leave unset. */
  mailto?: string
}

export interface LiteratureSourceDiagnostic {
  ok: boolean
  count: number
  error?: string
}

export interface LiteratureSearchDiagnostics {
  openalex: LiteratureSourceDiagnostic
  arxiv: LiteratureSourceDiagnostic
}

export type LiteratureSearchResult =
  | {
      success: true
      query: string
      durationMs: number
      totalFetched: number
      results: PaperSearchResult[]
      /** Per-source diagnostics surface partial failures (one source may
       *  401 / rate-limit while the other still yields rows). */
      diagnostics: LiteratureSearchDiagnostics
    }
  | {
      success: false
      error: string
      durationMs: number
    }

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
const DEFAULT_TIMEOUT_MS = 20_000
const MIN_TIMEOUT_MS = 5_000
const MAX_TIMEOUT_MS = 60_000

export async function searchLiterature(
  req: LiteratureSearchRequest,
): Promise<LiteratureSearchResult> {
  const start = Date.now()
  const query = req.query?.trim()
  if (!query) {
    return {
      success: false,
      error: 'Query is empty',
      durationMs: 0,
    }
  }
  const limit = clampInt(req.limit ?? DEFAULT_LIMIT, 1, MAX_LIMIT)
  const timeoutMs = clampInt(
    req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    MIN_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
  )

  const [openalex, arxiv] = await Promise.allSettled([
    searchOpenAlex(query, limit, timeoutMs, req.mailto),
    searchArxiv(query, limit, timeoutMs),
  ])

  const diagnostics: LiteratureSearchDiagnostics = {
    openalex: diagnosticsFor(openalex),
    arxiv: diagnosticsFor(arxiv),
  }

  const rows: PaperSearchResult[] = []
  if (openalex.status === 'fulfilled') rows.push(...openalex.value)
  if (arxiv.status === 'fulfilled') rows.push(...arxiv.value)

  const totalFetched = rows.length
  const results = dedupAndRank(rows).slice(0, limit)

  return {
    success: true,
    query,
    durationMs: Date.now() - start,
    totalFetched,
    results,
    diagnostics,
  }
}

// ── OpenAlex adapter ──────────────────────────────────────────────────────

interface OpenAlexAuthorship {
  author?: { display_name?: string }
}

interface OpenAlexBiblio {
  volume?: string | number | null
  issue?: string | number | null
  first_page?: string | number | null
  last_page?: string | number | null
}

interface OpenAlexLocationSource {
  display_name?: string
}

interface OpenAlexLocation {
  source?: OpenAlexLocationSource | null
}

interface OpenAlexWork {
  display_name?: string
  publication_year?: number | null
  authorships?: OpenAlexAuthorship[]
  abstract_inverted_index?: Record<string, number[]> | null
  doi?: string | null
  primary_location?: OpenAlexLocation | null
  biblio?: OpenAlexBiblio | null
  cited_by_count?: number | null
  open_access?: { is_oa?: boolean; oa_url?: string | null } | null
}

async function searchOpenAlex(
  query: string,
  limit: number,
  timeoutMs: number,
  mailto?: string,
): Promise<PaperSearchResult[]> {
  const params = new URLSearchParams({
    search: query,
    'per-page': String(limit),
    select:
      'display_name,publication_year,authorships,abstract_inverted_index,doi,primary_location,biblio,cited_by_count,open_access',
  })
  const contact = (mailto || process.env.OPENALEX_MAILTO || '').trim()
  if (contact) params.set('mailto', contact)

  const url = `https://api.openalex.org/works?${params.toString()}`
  const res = await fetchWithTimeout(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'Lattice-app/1.0 (literature-search)',
    },
    timeoutMs,
  })
  if (!res.ok) {
    throw new Error(
      `OpenAlex HTTP ${res.status}${res.statusText ? `: ${res.statusText}` : ''}`,
    )
  }
  const json = (await res.json()) as { results?: OpenAlexWork[] }
  const items = Array.isArray(json.results) ? json.results : []
  const rows: PaperSearchResult[] = []
  for (const item of items) {
    const title = (item.display_name || '').trim()
    if (!title) continue
    const authorships = Array.isArray(item.authorships) ? item.authorships : []
    const authors = authorships
      .slice(0, 5)
      .map((a) => (a.author?.display_name || '').trim())
      .filter((name) => name.length > 0)
      .join(', ')
    const rawDoi = item.doi || ''
    const doi = rawDoi.replace(/^https?:\/\/doi\.org\//i, '')
    const doiUrl = doi ? `https://doi.org/${doi}` : ''
    const venue = (item.primary_location?.source?.display_name || '').trim()
    const abstract = reconstructAbstract(item.abstract_inverted_index ?? null)
    const oaPdfUrl =
      typeof item.open_access?.oa_url === 'string' && item.open_access.oa_url.trim()
        ? item.open_access.oa_url.trim()
        : undefined
    rows.push({
      id: doi ? `doi:${doi}` : `openalex:${title.slice(0, 80)}`,
      title,
      abstract,
      authors,
      year: item.publication_year ? String(item.publication_year) : '',
      doi,
      url: doiUrl,
      source: 'openalex',
      venue,
      citedByCount:
        typeof item.cited_by_count === 'number'
          ? item.cited_by_count
          : undefined,
      oaPdfUrl,
    })
  }
  return rows
}

/** OpenAlex ships abstracts as an inverted index (`{ "word": [positions] }`)
 *  to discourage bulk re-publication. Reverse the mapping to recover a
 *  plain-text abstract — this is the same shape the CLI uses, and the
 *  function is short enough to inline here rather than pulling in another
 *  helper module. */
function reconstructAbstract(
  inverted: Record<string, number[]> | null,
): string {
  if (!inverted) return ''
  const positions: Array<[number, string]> = []
  for (const [word, indexes] of Object.entries(inverted)) {
    if (!Array.isArray(indexes)) continue
    for (const idx of indexes) {
      if (typeof idx === 'number' && Number.isFinite(idx)) {
        positions.push([idx, word])
      }
    }
  }
  if (positions.length === 0) return ''
  positions.sort((a, b) => a[0] - b[0])
  return positions.map(([, w]) => w).join(' ').trim()
}

// ── arXiv adapter ─────────────────────────────────────────────────────────

async function searchArxiv(
  query: string,
  limit: number,
  timeoutMs: number,
): Promise<PaperSearchResult[]> {
  // arXiv uses `search_query=all:<query>` where <query> is URI-encoded.
  // Using `searchParams.set` would also encode the colon in `all:`, which
  // the arXiv API does NOT accept — so we build the query string manually.
  const url =
    'https://export.arxiv.org/api/query' +
    `?search_query=all:${encodeURIComponent(query)}` +
    `&start=0&max_results=${limit}` +
    '&sortBy=relevance&sortOrder=descending'

  const res = await fetchWithTimeout(url, {
    headers: {
      accept: 'application/atom+xml,application/xml;q=0.9',
      'user-agent': 'Lattice-app/1.0 (literature-search)',
    },
    timeoutMs,
  })
  if (!res.ok) {
    throw new Error(
      `arXiv HTTP ${res.status}${res.statusText ? `: ${res.statusText}` : ''}`,
    )
  }
  return parseArxivFeed(await res.text())
}

/**
 * Parse an arXiv Atom feed into `PaperSearchResult[]`. Hand-rolled rather
 * than via a dependency because:
 *
 *   - arXiv's Atom format is stable (it's the only thing their API emits)
 *   - the feed is flat enough that a per-`<entry>` regex sweep is reliable
 *   - this call site only needs title / summary / published / authors / id
 *
 * If arXiv ever breaks the schema, the most degenerate outcome is an empty
 * list — the overall search still succeeds with whatever OpenAlex returned.
 */
function parseArxivFeed(xml: string): PaperSearchResult[] {
  const rows: PaperSearchResult[] = []
  // Split at `<entry ...>...</entry>`. The `s` flag makes `.` match line
  // breaks — required because each entry spans many lines.
  const entryRegex = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi
  let match: RegExpExecArray | null
  while ((match = entryRegex.exec(xml)) !== null) {
    const body = match[1]
    const title = collapseWhitespace(decodeXmlEntities(firstTag(body, 'title')))
    if (!title) continue
    const abstract = collapseWhitespace(
      decodeXmlEntities(firstTag(body, 'summary')),
    )
    const published = firstTag(body, 'published').trim()
    const year = published.length >= 4 ? published.slice(0, 4) : ''
    const authors = allTags(body, 'author')
      .slice(0, 5)
      .map((raw) => collapseWhitespace(decodeXmlEntities(firstTag(raw, 'name'))))
      .filter((name) => name.length > 0)
      .join(', ')
    const absUrl = firstTag(body, 'id').trim()
    const arxivId = extractArxivId(absUrl)
    const oaPdfUrl = arxivId
      ? `https://arxiv.org/pdf/${arxivId}.pdf`
      : undefined
    rows.push({
      id: arxivId ? `arxiv:${arxivId}` : absUrl || `arxiv:${title.slice(0, 80)}`,
      title,
      abstract,
      authors,
      year,
      doi: '',
      url: absUrl,
      source: 'arxiv',
      venue: 'arXiv',
      oaPdfUrl,
    })
  }
  return rows
}

function firstTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')
  const m = xml.match(re)
  return m ? m[1] : ''
}

function allTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi')
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) out.push(m[1])
  return out
}

function decodeXmlEntities(text: string): string {
  // Only the five predefined XML entities plus numeric refs are legal in a
  // well-formed Atom feed; arXiv sticks to these. No HTML entity map
  // needed.
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) =>
      String.fromCodePoint(Number.parseInt(n, 16)),
    )
}

function extractArxivId(absUrl: string): string {
  const match = absUrl.match(/arxiv\.org\/abs\/([\w.\-/]+?)(?:v\d+)?$/i)
  return match ? match[1] : ''
}

// ── Dedup + rank ──────────────────────────────────────────────────────────

/**
 * Deduplicate by:
 *   1. DOI when available (canonical), otherwise
 *   2. Normalised title (lower-case, alphanumeric only, first 120 chars).
 *
 * Ranking heuristic: OpenAlex rows with a citation count come first, sorted
 * descending; ties + no-count rows fall back to more-recent-first.
 * Matches the CLI's "surface the most influential papers" intent without
 * the full Semantic Scholar signal.
 */
function dedupAndRank(rows: PaperSearchResult[]): PaperSearchResult[] {
  const seen = new Map<string, PaperSearchResult>()
  for (const row of rows) {
    const key = row.doi
      ? `doi:${row.doi.toLowerCase()}`
      : `title:${normaliseTitle(row.title)}`
    const existing = seen.get(key)
    if (!existing) {
      seen.set(key, row)
      continue
    }
    // Prefer OpenAlex rows (richer metadata: DOI, citations, venue) when
    // deduplication finds the same paper on both sides.
    if (existing.source !== 'openalex' && row.source === 'openalex') {
      seen.set(key, row)
    }
  }
  const merged = Array.from(seen.values())
  merged.sort((a, b) => {
    const cA = a.citedByCount ?? -1
    const cB = b.citedByCount ?? -1
    if (cA !== cB) return cB - cA
    const yA = a.year ? Number(a.year) : 0
    const yB = b.year ? Number(b.year) : 0
    return yB - yA
  })
  return merged
}

function normaliseTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 120)
}

// ── Utilities ─────────────────────────────────────────────────────────────

function diagnosticsFor(
  settled: PromiseSettledResult<PaperSearchResult[]>,
): LiteratureSourceDiagnostic {
  if (settled.status === 'fulfilled') {
    return { ok: true, count: settled.value.length }
  }
  const err = settled.reason
  const message = err instanceof Error ? err.message : String(err)
  return { ok: false, count: 0, error: message }
}

interface FetchOptions {
  headers: Record<string, string>
  timeoutMs: number
}

async function fetchWithTimeout(
  url: string,
  opts: FetchOptions,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs)
  try {
    return await fetch(url, {
      method: 'GET',
      headers: opts.headers,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

function clampInt(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo
  return Math.max(lo, Math.min(hi, Math.round(value)))
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
