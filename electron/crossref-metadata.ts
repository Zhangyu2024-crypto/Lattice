/**
 * Resolve DOIs to bibliographic metadata via Crossref (same source as
 * worker/tools/library.py). Used when importing PDFs so directory scans
 * don't leave "Unknown" rows when the filename embeds a DOI.
 */

import { net } from 'electron'

const CROSSREF_BASE = 'https://api.crossref.org/works/'
// ASCII-only: HTTP header values must be ByteString (Latin-1, 0-255).
// An em dash here (U+2014) made undici reject every outbound request with
// "Cannot convert argument to a ByteString" — the entire refresh-metadata
// flow failed silently on every row before we surfaced errors.
const USER_AGENT =
  'Lattice-app/0.1 (mailto:lattice@local) - materials-science desktop app'

export interface CrossrefPaperMeta {
  doi: string
  title: string
  authors: string
  year: string
  journal?: string
  url?: string
  abstract?: string
}

export function normalizeDoi(raw: string): string {
  let doi = raw.trim()
  for (const prefix of ['https://doi.org/', 'http://doi.org/', 'doi:']) {
    if (doi.toLowerCase().startsWith(prefix)) {
      doi = doi.slice(prefix.length)
    }
  }
  // Repair the common scan-filename mangling where the registrar/suffix
  // slash collapsed into a space — Elsevier-style PDF names like
  // "10.1016 j.jeurceramsoc.2006.04.101.pdf" get written into the library
  // before the crossref pipeline existed. Normalising here means a lookup
  // by DOI dedup key (libraryDoiKey) treats the two forms as the same paper
  // so re-scans don't produce duplicates and refresh-metadata can match.
  doi = doi.replace(/^(10\.\d{4,})\s+([A-Za-z0-9])/, '$1/$2')
  return doi.trim()
}

/** Stable key for de-duplicating library rows by DOI. */
export function libraryDoiKey(doi: string): string {
  return normalizeDoi(doi).toLowerCase()
}

/**
 * Pull DOI candidates from a PDF file stem (basename without .pdf).
 * Handles common mangled forms, e.g. Elsevier exports:
 * `10.1016 j.jeurceramsoc.2007.10.007` → `10.1016/j.jeurceramsoc.2007.10.007`
 */
export function extractDoiCandidatesFromStem(stem: string): string[] {
  const normalized = stem
    .replace(/\.pdf$/i, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const out = new Set<string>()

  for (const m of normalized.matchAll(
    /(?:doi:\s*|https?:\/\/doi\.org\/)(10\.\d{4,}\/[^\s,;)]+)/gi,
  )) {
    out.add(normalizeDoi(m[1]!))
  }

  for (const m of normalized.matchAll(/\b(10\.\d{4,}\/[^\s,;)]+)\b/gi)) {
    out.add(normalizeDoi(m[1]!))
  }

  // Space instead of slash after registrar (e.g. "10.1016 j.journal.vol")
  for (const m of normalized.matchAll(
    /\b(10\.\d{4,})\s+([A-Za-z0-9][A-Za-z0-9.]*(?:\.[A-Za-z0-9][A-Za-z0-9.]*)+)\b/g,
  )) {
    const registrar = m[1]!
    const suffix = m[2]!
    if (!suffix.includes('/') && suffix.includes('.')) {
      out.add(`${registrar}/${suffix}`)
    }
  }

  return [...out]
}

export function pickBestDoiCandidate(candidates: string[]): string | null {
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]!
  return [...candidates].sort((a, b) => b.length - a.length)[0]!
}

function stripTags(text: string): string {
  const noTags = text.replace(/<[^>]+>/g, '')
  return noTags.replace(/\s+/g, ' ').trim()
}

function joinAuthors(authors: unknown): string {
  if (!Array.isArray(authors)) return 'Unknown'
  const parts: string[] = []
  for (const a of authors) {
    if (!a || typeof a !== 'object') continue
    const rec = a as Record<string, unknown>
    const given = String(rec.given ?? '').trim()
    const family = String(rec.family ?? '').trim()
    if (family && given) parts.push(`${family}, ${given}`)
    else if (family) parts.push(family)
    else if (given) parts.push(given)
  }
  return parts.length > 0 ? parts.join('; ') : 'Unknown'
}

function extractYear(message: Record<string, unknown>): string {
  for (const key of ['published-print', 'issued', 'created']) {
    const chunk = message[key]
    if (!chunk || typeof chunk !== 'object') continue
    const parts = (chunk as { 'date-parts'?: unknown })['date-parts']
    if (Array.isArray(parts) && parts.length > 0 && Array.isArray(parts[0])) {
      const y = parts[0]![0]
      if (typeof y === 'number' || typeof y === 'string') return String(y)
    }
  }
  return ''
}

/** Shape-only reason for why Crossref lookup didn't yield a record. The
 *  `refresh-metadata` handler distinguishes `invalid-doi` (skip silently)
 *  from `not-found` / `http` / `network` / `parse` (surface as errors so
 *  the user can tell why 100 rows all failed — before this split every
 *  failure collapsed to `return null` and looked identical to "no DOI"). */
export class CrossrefLookupError extends Error {
  constructor(
    message: string,
    public readonly kind:
      | 'invalid-doi'
      | 'not-found'
      | 'http'
      | 'network'
      | 'parse',
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'CrossrefLookupError'
  }
}

export async function fetchCrossrefByDoi(
  rawDoi: string,
  timeoutMs = 15_000,
): Promise<CrossrefPaperMeta | null> {
  const doi = normalizeDoi(rawDoi)
  if (!doi || !/^10\.\d{4,}\//.test(doi)) {
    // Kept as null — invalid-DOI is a "skip" condition, not an "error".
    return null
  }

  const url = CROSSREF_BASE + encodeURIComponent(doi)
  let res: Response
  try {
    res = await net.fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw new CrossrefLookupError(
      `network error contacting Crossref: ${
        err instanceof Error ? err.message : String(err)
      }`,
      'network',
    )
  }

  if (res.status === 404) {
    // Crossref returns 404 for DOIs it doesn't know about. Treat as "no
    // record" (null) rather than error so the UI still shows it as skip.
    return null
  }

  if (!res.ok) {
    let bodySnippet = ''
    try {
      bodySnippet = (await res.text()).slice(0, 200)
    } catch {
      /* best-effort */
    }
    throw new CrossrefLookupError(
      `Crossref HTTP ${res.status}${bodySnippet ? `: ${bodySnippet}` : ''}`,
      'http',
      res.status,
    )
  }

  let data: unknown
  try {
    data = await res.json()
  } catch (err) {
    throw new CrossrefLookupError(
      `Crossref response was not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
      'parse',
    )
  }

  if (!data || typeof data !== 'object') return null
  const message = (data as { message?: unknown }).message
  if (!message || typeof message !== 'object') return null
  const msg = message as Record<string, unknown>

  const titleList = msg.title
  let title = doi
  if (Array.isArray(titleList) && titleList.length > 0) {
    const t0 = titleList[0]
    if (typeof t0 === 'string' && t0.trim()) title = t0.trim()
  }

  const authors = joinAuthors(msg.author)
  const year = extractYear(msg)

  const container = msg['container-title']
  let journal: string | undefined
  if (Array.isArray(container) && typeof container[0] === 'string') {
    journal = container[0]
  }

  let abstract: string | undefined
  const ab = msg.abstract
  if (typeof ab === 'string' && ab.trim()) {
    abstract = stripTags(ab)
  }

  const urlField = msg.URL
  const resolvedUrl =
    typeof urlField === 'string' && urlField.trim()
      ? urlField.trim()
      : `https://doi.org/${doi}`

  return {
    doi,
    title,
    authors,
    year,
    journal,
    url: resolvedUrl,
    abstract,
  }
}

/** Try filename stem → Crossref. Returns null if no DOI or lookup fails.
 *  Callers in the scan-import path (`importPdfAtPath`) must never throw
 *  from this function — a transient Crossref error shouldn't abort the
 *  whole batch. We swallow `CrossrefLookupError` and log for diagnosis;
 *  the explicit `refresh-metadata` handler uses `fetchCrossrefByDoi`
 *  directly and handles errors there. */
export async function resolvePdfStemViaCrossref(
  stem: string,
): Promise<CrossrefPaperMeta | null> {
  const candidates = extractDoiCandidatesFromStem(stem)
  const best = pickBestDoiCandidate(candidates)
  if (!best) return null
  try {
    return await fetchCrossrefByDoi(best)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[crossref] scan-path lookup failed for ${best}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    return null
  }
}
