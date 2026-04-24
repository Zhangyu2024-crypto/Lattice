// Phase 3b · literature_search preview — input/output shape narrowing.
//
// The orchestrator's tool result is `unknown` to the registry, so we narrow
// it into discriminated structs here before handing anything to the view
// layer. Keeping these pure so the view files stay render-only.

export interface LitSearchInput {
  query: string
  limit?: number
}

export interface LitPaperRow {
  id: string
  title: string
  authors: string
  year: string
  venue: string
  doi: string
  url: string
  source: 'openalex' | 'arxiv' | string
  citedByCount?: number
  abstract: string
}

export interface LitDiagnostic {
  ok: boolean
  count: number
  error?: string
}

export interface LitSearchSuccess {
  ok: true
  query: string
  count: number
  durationMs: number
  results: LitPaperRow[]
  diagnostics?: {
    openalex?: LitDiagnostic
    arxiv?: LitDiagnostic
  }
}

export interface LitSearchFailure {
  ok: false
  error: string
}

export type LitSearchOutput = LitSearchSuccess | LitSearchFailure

export function narrowInput(value: unknown): LitSearchInput | null {
  if (!value || typeof value !== 'object') return null
  const v = value as { query?: unknown; limit?: unknown }
  if (typeof v.query !== 'string' || v.query.length === 0) return null
  return {
    query: v.query,
    limit:
      typeof v.limit === 'number' && Number.isFinite(v.limit)
        ? v.limit
        : undefined,
  }
}

export function narrowOutput(value: unknown): LitSearchOutput | null {
  if (!value || typeof value !== 'object') return null
  const v = value as { ok?: unknown; error?: unknown }
  if (v.ok === false) {
    return {
      ok: false,
      error: typeof v.error === 'string' ? v.error : 'unknown error',
    }
  }
  if (v.ok !== true) return null
  const full = value as Record<string, unknown>
  const query = typeof full.query === 'string' ? full.query : ''
  const count =
    typeof full.count === 'number' && Number.isFinite(full.count)
      ? full.count
      : 0
  const durationMs =
    typeof full.durationMs === 'number' && Number.isFinite(full.durationMs)
      ? full.durationMs
      : 0
  const rawResults = Array.isArray(full.results) ? full.results : []
  const results: LitPaperRow[] = []
  for (const raw of rawResults) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    if (typeof r.id !== 'string' || typeof r.title !== 'string') continue
    results.push({
      id: r.id,
      title: r.title,
      authors: typeof r.authors === 'string' ? r.authors : '',
      year: typeof r.year === 'string' ? r.year : '',
      venue: typeof r.venue === 'string' ? r.venue : '',
      doi: typeof r.doi === 'string' ? r.doi : '',
      url: typeof r.url === 'string' ? r.url : '',
      source: typeof r.source === 'string' ? r.source : 'unknown',
      citedByCount:
        typeof r.citedByCount === 'number' && Number.isFinite(r.citedByCount)
          ? r.citedByCount
          : undefined,
      abstract: typeof r.abstract === 'string' ? r.abstract : '',
    })
  }
  const diagnostics = narrowDiagnostics(full.diagnostics)
  return {
    ok: true,
    query,
    count,
    durationMs,
    results,
    diagnostics,
  }
}

export function narrowDiagnostics(
  value: unknown,
): LitSearchSuccess['diagnostics'] | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  const pick = (raw: unknown): LitDiagnostic | undefined => {
    if (!raw || typeof raw !== 'object') return undefined
    const r = raw as Record<string, unknown>
    return {
      ok: r.ok === true,
      count:
        typeof r.count === 'number' && Number.isFinite(r.count)
          ? r.count
          : 0,
      error: typeof r.error === 'string' ? r.error : undefined,
    }
  }
  return { openalex: pick(v.openalex), arxiv: pick(v.arxiv) }
}
