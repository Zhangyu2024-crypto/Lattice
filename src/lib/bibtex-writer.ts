// Minimal BibTeX writer. Serialises `LibraryPaperRow[]` to a `.bib`
// string without pulling in a library — matches the import path in
// `bibtex-parser.ts` for round-trip parity.
//
// Entry type selection is a heuristic:
//   - has a journal → `article`
//   - has an arXiv source → `misc`
//   - otherwise → `misc` (safe fallback; callers can edit)
//
// Citation keys come from `bib_key` when the row has one; otherwise we
// derive `<firstAuthorSurname><year>` — matching what lattice-cli's
// `bib_key()` helper emits so re-importing our export doesn't duplicate
// rows.

import type { LibraryPaperRow } from '../types/library-api'

export function writeBibTeX(papers: LibraryPaperRow[]): string {
  const seenKeys = new Set<string>()
  const blocks: string[] = []
  for (const paper of papers) {
    const entryType = pickEntryType(paper)
    const rawKey = (paper.bib_key?.trim() || deriveCitationKey(paper))
    const key = uniqueKey(rawKey, seenKeys)
    seenKeys.add(key)
    const fields: Array<[string, string]> = []
    if (paper.title) fields.push(['title', escapeValue(paper.title)])
    if (paper.authors) fields.push(['author', formatAuthorList(paper.authors)])
    if (paper.year) fields.push(['year', paper.year])
    if (paper.journal) fields.push(['journal', escapeValue(paper.journal)])
    if (paper.doi) fields.push(['doi', paper.doi])
    if (paper.url && !paper.doi) fields.push(['url', paper.url])
    if (paper.abstract) fields.push(['abstract', escapeValue(paper.abstract)])
    if (paper.notes) fields.push(['note', escapeValue(paper.notes)])

    const body = fields
      .map(([name, value]) => `  ${name} = {${value}}`)
      .join(',\n')
    blocks.push(`@${entryType}{${key},\n${body}\n}`)
  }
  return `${blocks.join('\n\n')}\n`
}

function pickEntryType(paper: LibraryPaperRow): string {
  if (paper.journal && paper.journal.trim()) return 'article'
  return 'misc'
}

function deriveCitationKey(paper: LibraryPaperRow): string {
  const firstAuthor = (paper.authors || '')
    .split(',')[0]
    .trim()
    .split(/\s+/)
    .pop() || 'ref'
  const slug = firstAuthor.toLowerCase().replace(/[^a-z0-9]/g, '')
  const year = /\d{4}/.exec(paper.year || '')?.[0] ?? ''
  return `${slug || 'ref'}${year}`
}

function uniqueKey(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}_${n}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base}_${Date.now()}`
}

function formatAuthorList(authors: string): string {
  // Library stores authors comma-joined; BibTeX prefers ` and `.
  // Handles edge case "Last, First" correctly only for the simple case
  // — if the author string already contains no ` and `, we split on
  // commas and rejoin with ` and `.
  if (/\s+and\s+/i.test(authors)) return escapeValue(authors)
  const parts = authors
    .split(',')
    .map((a) => a.trim())
    .filter((a) => a.length > 0)
  if (parts.length <= 1) return escapeValue(authors)
  return parts.map(escapeValue).join(' and ')
}

function escapeValue(value: string): string {
  // BibTeX is lenient inside `{...}` — the main concern is balancing
  // braces and escaping literal `{` / `}` that aren't ours. We never
  // emit stray braces in the values above, so just protect the few
  // TeX-meaningful characters the user could have in free text.
  return value
    .replace(/([\\])/g, '\\$1')
    .replace(/([%&$#_])/g, '\\$1')
    .replace(/\s+/g, ' ')
    .trim()
}
