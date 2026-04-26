// Bridge between the electron-side literature search (OpenAlex + arXiv) and
// the research-report flow (plan_outline / draft_section / finalize).
//
// The CLI does per-section relevance filtering with CJK-aware bigrams
// (`survey_pipeline.py::_extract_keywords` / `_select_relevant_papers`). We
// mirror that here so a draft for "Mechanism & Structure" gets a different
// paper shortlist than a draft for "Validation Plan", while each paper is
// still drawn from one shared pool fetched once at plan-time.

import type { PaperSearchResultPayload } from '../../../types/electron'
import { localProLibrary } from '../../local-pro-library'
import type { Citation, ResearchRetrievalMeta } from '../research-shared'

export type Paper = Omit<PaperSearchResultPayload, 'source'> & {
  source: PaperSearchResultPayload['source'] | 'local_library'
}

const MIN_KEYWORD_LEN = 2
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'in', 'on', 'for', 'with',
  'to', 'from', 'by', 'as', 'is', 'are', 'was', 'were', 'be', 'been',
  'this', 'that', 'these', 'those', 'it', 'its', 'we', 'our', 'their',
])

/** Strip the OpenAlex identifier wrapper / trailing whitespace so we can
 *  produce compact slugs for citation ids. */
function normaliseDoi(doi: string): string {
  return doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').trim()
}

/** Stable ASCII slug that can be used as both a `[@cite:<id>]` token and a
 *  `citations[].id`. Matches the CLI's `PaperInfo.bib_key()` shape closely. */
export function paperToCitationId(paper: Paper): string {
  const firstAuthor = (paper.authors || '')
    .split(',')[0]
    ?.trim()
    .split(/\s+/)
    .pop() ?? 'anon'
  const year = paper.year || 'nd'
  const slug = paper.doi
    ? normaliseDoi(paper.doi).replace(/[^a-zA-Z0-9]+/g, '').slice(-6).toLowerCase()
    : paper.id.replace(/[^a-zA-Z0-9]+/g, '').slice(-6).toLowerCase()
  const authorSlug = firstAuthor.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 12)
  return `${authorSlug || 'ref'}${year}${slug ? `_${slug}` : ''}`
}

/** Project an electron-side paper row into the shape expected by the
 *  research-report artifact payload. `unverified=false` turns off the
 *  "these citations were invented" banner in the card. */
export function paperToCitation(paper: Paper): Citation {
  const authors = (paper.authors || '')
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean)
  const year = Number.parseInt(paper.year || '', 10)
  return {
    id: paperToCitationId(paper),
    title: paper.title || '(untitled)',
    authors: authors.length > 0 ? authors : ['Unknown'],
    year: Number.isFinite(year) ? year : 0,
    venue: paper.venue || null,
    doi: paper.doi || null,
    url: paper.url || null,
    unverified: false,
  }
}

/** One-line summary of a paper that fits inside an LLM prompt without
 *  bloating the context window. Used as the `Candidate references` block
 *  the plan / draft prompts stitch in. */
export function paperSummaryLine(paper: Paper, citationId: string): string {
  const parts: string[] = []
  parts.push(`[@cite:${citationId}]`)
  const firstAuthor = (paper.authors || '').split(',')[0]?.trim() ?? 'Unknown'
  const etAl =
    (paper.authors || '').split(',').length > 1 ? ' et al.' : ''
  parts.push(`${firstAuthor}${etAl}${paper.year ? ` (${paper.year})` : ''}.`)
  parts.push(`"${paper.title}"`)
  if (paper.venue) parts.push(`— ${paper.venue}`)
  if (paper.source) parts.push(`[${paper.source}${paper.citedByCount != null ? `, cited ${paper.citedByCount}` : ''}]`)
  return parts.join(' ')
}

/** Unicode-aware keyword extractor.
 *
 *  - ASCII: split on non-word, drop stop-words, keep tokens ≥ 2 chars.
 *  - CJK (U+4E00..U+9FFF): generate every 2-char window. Single Chinese
 *    characters are too ambiguous to rank on; bigrams are the practical
 *    sweet spot lattice-cli settled on.
 */
export function extractKeywords(text: string): string[] {
  const out = new Set<string>()
  const ascii = text.toLowerCase().match(/[a-z][a-z0-9]{1,}/g) ?? []
  for (const w of ascii) {
    if (w.length < MIN_KEYWORD_LEN) continue
    if (STOP_WORDS.has(w)) continue
    out.add(w)
  }
  const cjk = text.match(/[\u4e00-\u9fff]{2,}/g) ?? []
  for (const run of cjk) {
    for (let i = 0; i <= run.length - 2; i++) {
      out.add(run.slice(i, i + 2))
    }
  }
  return [...out]
}

/** Tally keyword hits in a paper's title + abstract. Titles count more. */
function relevanceScore(paper: Paper, keywords: string[]): number {
  if (keywords.length === 0) return 0
  const title = (paper.title || '').toLowerCase()
  const abstract = (paper.abstract || '').toLowerCase()
  let score = 0
  for (const kw of keywords) {
    if (title.includes(kw)) score += 3
    if (abstract.includes(kw)) score += 1
  }
  return score
}

/** Pick up to `limit` papers most relevant to `sectionHeading`. Always
 *  includes the top-`alwaysKeep` papers by citation count so every section
 *  sees a backbone of widely-cited work, even when the keyword overlap is
 *  thin. */
export function selectRelevantPapers(
  papers: Paper[],
  sectionHeading: string,
  options: { limit?: number; alwaysKeep?: number } = {},
): Paper[] {
  const limit = options.limit ?? 10
  const alwaysKeep = options.alwaysKeep ?? 3
  if (papers.length === 0) return []
  const keywords = extractKeywords(sectionHeading)
  const ranked = papers
    .map((p) => ({ paper: p, score: relevanceScore(p, keywords) }))
    .sort((a, b) => b.score - a.score)
  const topRelevant = ranked.slice(0, limit).map((r) => r.paper)

  // Backfill with top-cited papers if they're not already in the set.
  const byCitation = [...papers].sort(
    (a, b) => (b.citedByCount ?? 0) - (a.citedByCount ?? 0),
  )
  const keep = new Set(topRelevant.map((p) => p.id))
  for (const p of byCitation.slice(0, alwaysKeep)) {
    if (keep.has(p.id)) continue
    topRelevant.push(p)
    keep.add(p.id)
    if (topRelevant.length >= limit) break
  }
  return topRelevant.slice(0, limit)
}

/** Call the electron-side literature search. Returns an empty array on any
 *  failure — the caller's prompt falls back to "no grounding" gracefully. */
export async function searchPapers(
  query: string,
  limit: number,
): Promise<Paper[]> {
  const api = window.electronAPI
  if (!api?.literatureSearch) return []
  try {
    const res = await api.literatureSearch({ query, limit })
    if (!res || !res.success) return []
    return res.results as Paper[]
  } catch {
    return []
  }
}

export interface MultiQuerySearchResult {
  papers: Paper[]
  meta: ResearchRetrievalMeta
}

export async function searchPapersForResearch(args: {
  topic: string
  focus?: string | null
  variantQueries?: string[]
  limitPerQuery?: number
  maxQueries?: number
}): Promise<MultiQuerySearchResult> {
  const topic = args.topic.trim()
  const focus = args.focus?.trim()
  const baseQuery = focus ? `${topic} ${focus}` : topic
  const currentYear = new Date().getFullYear()
  const rawQueries = [
    baseQuery,
    `"${baseQuery}" survey OR review`,
    ...(args.variantQueries ?? []),
    `"${baseQuery}" ${currentYear - 2} OR ${currentYear - 1} OR ${currentYear}`,
  ]
  const queries = dedupeStrings(rawQueries)
    .filter((query) => query.length >= 3)
    .slice(0, args.maxQueries ?? 6)
  const [onlineBatches, localBatches] = await Promise.all([
    Promise.all(
      queries.map((query) => searchPapers(query, args.limitPerQuery ?? 30)),
    ),
    Promise.all(
      queries.map((query) => searchLocalLibraryPapers(query, args.limitPerQuery ?? 30)),
    ),
  ])
  const merged = dedupePapers([...onlineBatches.flat(), ...localBatches.flat()])
  const keywords = extractKeywords(baseQuery)
  const filtered = filterResearchPapers(merged, keywords)
  const papers = rankResearchPapers(filtered.length > 0 ? filtered : merged)
  return {
    papers,
    meta: {
      ...buildRetrievalMeta(queries, merged.length, papers),
      localLibraryQueries: queries,
    },
  }
}


async function searchLocalLibraryPapers(
  query: string,
  limit: number,
): Promise<Paper[]> {
  if (!localProLibrary.ready) return []
  try {
    const res = await localProLibrary.listPapers({
      q: query,
      limit: Math.max(1, Math.min(limit, 50)),
      sort: 'year',
      order: 'desc',
    })
    return res.papers.map((paper) => ({
      id: `local:${paper.id}`,
      title: paper.title || '(untitled)',
      abstract: paper.abstract || paper.notes || '',
      authors: paper.authors || '',
      year: paper.year || '',
      doi: paper.doi || '',
      url: paper.url || '',
      source: 'local_library' as const,
      venue: paper.journal || '',
      citedByCount: paper.citation_count,
    }))
  } catch {
    return []
  }
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const clean = value.trim().replace(/\s+/g, ' ')
    if (!clean) continue
    const key = clean.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(clean)
  }
  return out
}

function dedupePapers(papers: Paper[]): Paper[] {
  const byKey = new Map<string, Paper>()
  for (const paper of papers) {
    const key = paper.doi
      ? `doi:${normaliseDoi(paper.doi).toLowerCase()}`
      : `title:${paper.title.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 140)}`
    if (!key.endsWith(':')) {
      const current = byKey.get(key)
      if (!current || preferredPaper(paper, current) === paper) byKey.set(key, paper)
    }
  }
  return Array.from(byKey.values())
}

function preferredPaper(a: Paper, b: Paper): Paper {
  if (a.source === 'local_library' && b.source !== 'local_library') return a
  if (b.source === 'local_library' && a.source !== 'local_library') return b
  if (a.source === 'openalex' && b.source !== 'openalex') return a
  if (b.source === 'openalex' && a.source !== 'openalex') return b
  return (a.citedByCount ?? 0) >= (b.citedByCount ?? 0) ? a : b
}

function filterResearchPapers(papers: Paper[], keywords: string[]): Paper[] {
  if (keywords.length === 0) return papers
  return papers.filter((paper) => {
    const score = relevanceScore(paper, keywords)
    return score >= 1 || ((paper.citedByCount ?? 0) >= 50 && score > 0)
  })
}

function rankResearchPapers(papers: Paper[]): Paper[] {
  const currentYear = new Date().getFullYear()
  const recentCount = papers.filter((paper) => {
    const year = Number.parseInt(paper.year || '', 10)
    return Number.isFinite(year) && year >= currentYear - 3
  }).length
  const boostRecent = papers.length > 0 && recentCount / papers.length < 0.2
  return [...papers].sort((a, b) => {
    if (boostRecent) {
      const aYear = Number.parseInt(a.year || '', 10)
      const bYear = Number.parseInt(b.year || '', 10)
      const aRecent = Number.isFinite(aYear) && aYear >= currentYear - 3
      const bRecent = Number.isFinite(bYear) && bYear >= currentYear - 3
      if (aRecent !== bRecent) return aRecent ? -1 : 1
    }
    const citeDelta = (b.citedByCount ?? -1) - (a.citedByCount ?? -1)
    if (citeDelta !== 0) return citeDelta
    return Number.parseInt(b.year || '0', 10) - Number.parseInt(a.year || '0', 10)
  })
}

function buildRetrievalMeta(
  queries: string[],
  totalRetrieved: number,
  papers: Paper[],
): ResearchRetrievalMeta {
  const yearDistribution: Record<string, number> = {}
  const sourceDistribution: Record<string, number> = {}
  for (const paper of papers) {
    const year = paper.year || 'unknown'
    yearDistribution[year] = (yearDistribution[year] ?? 0) + 1
    const source = paper.source || 'unknown'
    sourceDistribution[source] = (sourceDistribution[source] ?? 0) + 1
  }
  const years = Object.keys(yearDistribution)
    .filter((year) => /^\d{4}$/.test(year))
    .sort()
  return {
    queries,
    totalRetrieved,
    papersUsed: papers.length,
    yearRange: years.length > 0 ? `${years[0]}-${years[years.length - 1]}` : null,
    yearDistribution,
    sourceDistribution,
    sourcesUsed: Object.keys(sourceDistribution).sort(),
  }
}
