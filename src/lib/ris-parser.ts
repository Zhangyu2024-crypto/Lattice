// Zero-dependency RIS parser.
//
// RIS is a line-oriented format: each line is `TAG  - value` (two spaces,
// dash, space, value). A record starts at `TY  - <type>` and ends at
// `ER  -`. Long values can wrap onto continuation lines (no tag prefix).
//
// We only project the subset of tags that maps cleanly to the library
// shape; everything else is dropped without error so adding a tag later
// is an additive change rather than a schema break.

export interface RisRecord {
  ty: string
  fields: Record<string, string[]>
}

export interface RisParseResult {
  records: RisRecord[]
  errors: Array<{ line: number; message: string }>
}

const TAG_LINE = /^([A-Z][A-Z0-9])\s{2}-\s?(.*)$/

export function parseRIS(source: string): RisParseResult {
  const records: RisRecord[] = []
  const errors: RisParseResult['errors'] = []
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  let current: RisRecord | null = null
  let lastTag: string | null = null
  let openLine = 0

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const raw = lines[lineIdx]
    if (!raw) {
      continue
    }
    const match = TAG_LINE.exec(raw)
    if (!match) {
      // Continuation line for the previous value — append to the last
      // field on the current record so long abstracts don't get lost.
      if (current && lastTag) {
        const list = current.fields[lastTag]
        if (list && list.length > 0) {
          const tail = list[list.length - 1]
          list[list.length - 1] = `${tail} ${raw.trim()}`.trim()
        }
      }
      continue
    }
    const tag = match[1]
    const value = match[2].trim()

    if (tag === 'TY') {
      if (current) {
        errors.push({
          line: lineIdx + 1,
          message: 'new TY record started before ER — previous record closed implicitly',
        })
        records.push(current)
      }
      current = { ty: value, fields: {} }
      lastTag = 'TY'
      openLine = lineIdx + 1
      continue
    }

    if (tag === 'ER') {
      if (!current) {
        errors.push({ line: lineIdx + 1, message: 'ER without matching TY' })
        continue
      }
      records.push(current)
      current = null
      lastTag = null
      continue
    }

    if (!current) {
      errors.push({
        line: lineIdx + 1,
        message: `tag ${tag} before any TY`,
      })
      continue
    }

    const list = current.fields[tag] ?? []
    if (value) list.push(value)
    current.fields[tag] = list
    lastTag = tag
  }

  if (current) {
    errors.push({
      line: openLine,
      message: 'record not terminated with ER — importing anyway',
    })
    records.push(current)
  }
  return { records, errors }
}

// ── Tag → library row projection ─────────────────────────────────────
//
// Ref: https://en.wikipedia.org/wiki/RIS_(file_format) for the tag
// reference. Common authors of exports (EndNote, Zotero, ScienceDirect,
// Scopus) all use the same core subset; we stay inside that core.

export interface RisPaperDraft {
  title: string
  authors: string
  year: string
  doi?: string
  url?: string
  journal?: string
  abstract?: string
  bibKey: string
}

export function recordToPaperDraft(record: RisRecord): RisPaperDraft | null {
  const title = firstNonEmpty(record.fields.TI, record.fields.T1, record.fields.CT)
  if (!title) return null
  const authors = joinAuthors(
    record.fields.AU ?? record.fields.A1 ?? record.fields.A2 ?? [],
  )
  const year = extractYear(
    firstNonEmpty(record.fields.PY, record.fields.Y1, record.fields.DA),
  )
  const doi = (record.fields.DO?.[0] ?? '').trim().replace(/^https?:\/\/doi\.org\//i, '')
  const urlField = record.fields.UR?.[0]?.trim()
  const url = urlField || (doi ? `https://doi.org/${doi}` : undefined)
  const journal = firstNonEmpty(
    record.fields.JO,
    record.fields.JF,
    record.fields.T2,
    record.fields.JA,
  )
  const abstract = firstNonEmpty(record.fields.AB, record.fields.N2)
  const bibKey = (record.fields.ID?.[0] ?? '').trim() || deriveBibKey(authors, year)

  return {
    title,
    authors,
    year,
    doi: doi || undefined,
    url,
    journal: journal || undefined,
    abstract: abstract || undefined,
    bibKey,
  }
}

function firstNonEmpty(...candidates: Array<string[] | undefined>): string {
  for (const list of candidates) {
    if (list && list.length > 0) {
      const first = list[0]?.trim()
      if (first) return first
    }
  }
  return ''
}

function joinAuthors(list: string[]): string {
  return list
    .map((a) => a.trim())
    .filter((a) => a.length > 0)
    .join(', ')
}

function extractYear(raw: string): string {
  const match = raw.match(/\b(\d{4})\b/)
  return match ? match[1] : ''
}

function deriveBibKey(authors: string, year: string): string {
  const firstSurname =
    authors.split(',')[0]?.trim().split(/\s+/)[0] ?? 'ref'
  const slug = firstSurname.toLowerCase().replace(/[^a-z0-9]/g, '') || 'ref'
  return `${slug}${year}`
}
