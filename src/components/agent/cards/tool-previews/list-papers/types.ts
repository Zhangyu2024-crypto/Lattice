// Phase 3b · list_papers preview — input/output shape narrowing.
//
// The orchestrator's tool result arrives as `unknown`; we narrow it into
// typed structs here so the view layer can stay render-only. Mirrors the
// split applied to LiteratureSearchCardPreview.

export interface ListPapersInput {
  q?: string
  tag?: string
  year?: string
  collection?: string
  limit?: number
  sort?: string
  order?: string
}

export interface LibraryPaperRow {
  id: number
  title: string
  authors: string
  year: string
  journal?: string
  doi?: string
  tags?: string[]
  hasPdf: boolean
}

export interface ListPapersOutput {
  total: number
  returned: number
  papers: LibraryPaperRow[]
}

export function narrowInput(value: unknown): ListPapersInput {
  if (!value || typeof value !== 'object') return {}
  const v = value as Record<string, unknown>
  const pickStr = (k: string): string | undefined =>
    typeof v[k] === 'string' && (v[k] as string).length > 0
      ? (v[k] as string)
      : undefined
  const pickNum = (k: string): number | undefined =>
    typeof v[k] === 'number' && Number.isFinite(v[k])
      ? (v[k] as number)
      : undefined
  return {
    q: pickStr('q'),
    tag: pickStr('tag'),
    year: pickStr('year'),
    collection: pickStr('collection'),
    limit: pickNum('limit'),
    sort: pickStr('sort'),
    order: pickStr('order'),
  }
}

export function narrowOutput(value: unknown): ListPapersOutput | null {
  if (!value || typeof value !== 'object') return null
  const v = value as {
    total?: unknown
    returned?: unknown
    papers?: unknown
  }
  if (!Array.isArray(v.papers)) return null
  const papers: LibraryPaperRow[] = []
  for (const raw of v.papers) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    if (typeof r.id !== 'number' || !Number.isFinite(r.id)) continue
    if (typeof r.title !== 'string') continue
    papers.push({
      id: r.id,
      title: r.title,
      authors: typeof r.authors === 'string' ? r.authors : '',
      year: typeof r.year === 'string' ? r.year : '',
      journal: typeof r.journal === 'string' ? r.journal : undefined,
      doi: typeof r.doi === 'string' ? r.doi : undefined,
      tags: Array.isArray(r.tags)
        ? (r.tags.filter((t) => typeof t === 'string') as string[])
        : undefined,
      hasPdf: r.hasPdf === true,
    })
  }
  const total =
    typeof v.total === 'number' && Number.isFinite(v.total)
      ? v.total
      : papers.length
  const returned =
    typeof v.returned === 'number' && Number.isFinite(v.returned)
      ? v.returned
      : papers.length
  return { total, returned, papers }
}
