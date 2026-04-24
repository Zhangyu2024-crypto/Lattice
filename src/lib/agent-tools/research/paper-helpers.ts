// Bridge between the electron-side literature search (OpenAlex + arXiv) and
// the research-report flow (plan_outline / draft_section / finalize).
//
// The CLI does per-section relevance filtering with CJK-aware bigrams
// (`survey_pipeline.py::_extract_keywords` / `_select_relevant_papers`). We
// mirror that here so a draft for "Mechanism & Structure" gets a different
// paper shortlist than a draft for "Validation Plan", while each paper is
// still drawn from one shared pool fetched once at plan-time.

import type { PaperSearchResultPayload } from '../../../types/electron'
import type { Citation } from '../research-shared'

export type Paper = PaperSearchResultPayload

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
    return res.results
  } catch {
    return []
  }
}
