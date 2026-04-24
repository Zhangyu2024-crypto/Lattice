export function splitPaperAuthors(
  authors: readonly string[] | string | null | undefined,
): string[] {
  if (Array.isArray(authors)) {
    return authors.map((name) => name.trim()).filter(Boolean)
  }
  const raw = typeof authors === 'string' ? authors.trim() : ''
  if (!raw) return []

  const bySemicolon = raw
    .split(';')
    .map((name: string) => name.trim())
    .filter(Boolean)
  if (bySemicolon.length > 1) return bySemicolon

  const byAnd = raw
    .split(/\s+and\s+/i)
    .map((name: string) => name.trim())
    .filter(Boolean)
  if (byAnd.length > 1) return byAnd

  return [raw]
}

/** Canonical `10.xxxx/suffix` form. */
const DOI_STRICT = /\b(10\.\d{4,9}\/[^\s,;)]+)/i

/**
 * Publishers sometimes mangle DOIs as `10.1016 j.jeurceramsoc...` (space
 * instead of `/`). Capture a registry suffix with at least one dot.
 */
const DOI_LOOSE = /\b(10\.\d{4,9})\s+([A-Za-z0-9][A-Za-z0-9._-]*(?:\.[A-Za-z0-9._-]+)+)/i

function stripTrailingPunct(s: string): string {
  return s.replace(/[),.;:]+$/g, '')
}

function normalizeDoiSearchText(text: string): string {
  return text
    .replace(/https?:\/\/doi\.org\//gi, '')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Prefer an explicit `doi` field, then a strict in-title match, then a
 * loose (space-separated) match normalised to `10.prefix/suffix`.
 */
export function extractDoiCandidate(
  text: string,
  knownDoi?: string | null,
): string | null {
  const k = knownDoi?.trim()
  if (k) {
    const nk = k.replace(/^https?:\/\/doi\.org\//i, '')
    const s = nk.match(DOI_STRICT)?.[1]
    if (s) return stripTrailingPunct(s)
    const looseK = nk.match(DOI_LOOSE)
    if (looseK) return stripTrailingPunct(`${looseK[1]}/${looseK[2]}`)
    const normK = normalizeDoiSearchText(nk)
    const looseNorm = normK.match(DOI_LOOSE)
    if (looseNorm)
      return stripTrailingPunct(`${looseNorm[1]}/${looseNorm[2]}`)
    if (/^10\.\d{4,9}\/[^\s]+/i.test(nk)) return stripTrailingPunct(nk)
  }

  const clean = normalizeDoiSearchText(text)
  const strictM = clean.match(DOI_STRICT)
  if (strictM) return stripTrailingPunct(strictM[1])
  const looseM = clean.match(DOI_LOOSE)
  if (looseM) return stripTrailingPunct(`${looseM[1]}/${looseM[2]}`)
  return null
}

function titleLooksLikeMetadataBlob(
  clean: string,
  extractedDoi: string | null,
): boolean {
  if (!clean) return false
  if (/\bunknown author\b/i.test(clean)) return true
  if (/\bdoi\b/i.test(clean) && /\b10\.\d/.test(clean)) return true
  if (/\b\d{13,}\b/.test(clean)) return true
  if (/^10\.\d{4,9}(\/|\s+)/i.test(clean)) return true

  if (extractedDoi) {
    const tail = extractedDoi.split('/').pop() ?? ''
    if (tail.length >= 8) {
      const esc = tail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(esc, 'gi')
      const hits = clean.match(re)
      if (hits && hits.length >= 2) return true
    }
  }

  const tokens = clean.split(/\s+/).map((t) =>
    t.replace(/^[(\[{]+|[)\]},.;:]+$/g, ''),
  )
  const counts = new Map<string, number>()
  for (const t of tokens) {
    if (t.length < 12 || !/[a-z]/i.test(t) || !/\d/.test(t)) continue
    const key = t.toLowerCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  for (const c of counts.values()) {
    if (c >= 2) return true
  }
  return false
}

export function isUnknownPaperAuthor(value: string | null | undefined): boolean {
  const normalized = (value ?? '').trim().toLowerCase()
  return (
    normalized.length === 0 ||
    normalized === 'unknown' ||
    normalized === 'unknown author' ||
    normalized === 'n/a'
  )
}

export function sanitizePaperTitle(
  title: string,
  options?: { knownDoi?: string | null },
): string {
  const clean = normalizeDoiSearchText(title)
  if (!clean) return 'Untitled paper'

  const doi =
    extractDoiCandidate(clean, options?.knownDoi ?? undefined) ??
    extractDoiCandidate(title, options?.knownDoi ?? undefined)

  if (titleLooksLikeMetadataBlob(clean, doi) && doi) {
    return `DOI ${doi}`
  }

  return clean
}

export interface PaperReaderHeadlineFields {
  title: string
  doi?: string | null
  year?: number
  venue?: string | null
}

/**
 * Short, human-readable headline for toolbars and the PDF card header.
 * `detailTitle` keeps the raw catalog title for tooltips / debugging.
 */
export function paperReaderHeadline(
  fields: PaperReaderHeadlineFields,
): { headline: string; detailTitle: string } {
  const raw = (fields.title ?? '').trim()
  const detailTitle = raw || 'Untitled paper'
  const knownDoi = fields.doi?.trim() || undefined
  const normalized = normalizeDoiSearchText(raw)
  const doi = extractDoiCandidate(normalized, knownDoi)
  const isBlob = titleLooksLikeMetadataBlob(normalized, doi)
  const y = fields.year && fields.year > 0 ? fields.year : null
  const venue = fields.venue?.trim()

  if (isBlob && venue) {
    return {
      headline: y ? `${venue} (${y})` : venue,
      detailTitle,
    }
  }

  let headline = sanitizePaperTitle(raw, { knownDoi })
  if (y && /^DOI\s+10\./i.test(headline)) {
    headline = `${headline} · ${y}`
  }
  return { headline, detailTitle }
}

export function formatPaperArtifactTitle(
  title: string,
  authors: readonly string[] | string | null | undefined,
  doi?: string | null,
): string {
  const cleanTitle = sanitizePaperTitle(title, { knownDoi: doi })
  const names = splitPaperAuthors(authors).filter(
    (name) => !isUnknownPaperAuthor(name),
  )
  if (names.length === 0) return cleanTitle
  if (names.length === 1) return `${cleanTitle} - ${names[0]}`
  if (names.length === 2) return `${cleanTitle} - ${names[0]}, ${names[1]}`
  return `${cleanTitle} - ${names[0]} et al.`
}
