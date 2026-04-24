// Minimal zero-dependency BibTeX parser.
//
// Scope: enough to import typical Zotero / Mendeley / Google Scholar
// exports into the local library. We intentionally do NOT support
// `@preamble` / `@string` macros — they're rare in the user-facing
// exports this tool is meant to consume, and handling them right
// doubles the surface area. Malformed entries are skipped with a
// per-entry error rather than killing the whole import.
//
// Extracted field subset maps to `StoredLibraryPaper`:
//   - title, author (joined with ", "), year, doi, url,
//     journal|booktitle|series → journal, abstract, pages, note → notes
//
// Author name handling: `First Last and First Last and …` → `First Last, First Last, …`
// to match the shape the library expects (comma-joined string).

export interface BibTeXEntry {
  /** Entry type in lower case (`article`, `misc`, `inproceedings`, …). */
  entryType: string
  /** BibTeX citation key (`fan2024photocatalysis`). */
  citationKey: string
  /** Lowercase field → value map with outer braces and quotes stripped. */
  fields: Record<string, string>
}

export interface BibTeXParseResult {
  entries: BibTeXEntry[]
  /** Parse errors keyed by approximate line number so the UI can surface
   *  "entry #3 (line 47) could not be parsed". Non-fatal — the importer
   *  proceeds with whatever entries did parse. */
  errors: Array<{ line: number; message: string }>
}

export function parseBibTeX(source: string): BibTeXParseResult {
  const entries: BibTeXEntry[] = []
  const errors: BibTeXParseResult['errors'] = []
  const text = source.replace(/\r\n?/g, '\n')
  let i = 0
  let line = 1

  const advanceLineCounter = (from: number, to: number) => {
    for (let p = from; p < to; p++) if (text.charCodeAt(p) === 10) line += 1
  }

  while (i < text.length) {
    const atIdx = text.indexOf('@', i)
    if (atIdx < 0) break
    advanceLineCounter(i, atIdx)
    i = atIdx + 1

    // Entry type — letters until `{`. Also skip @comment / @preamble /
    // @string blocks rather than trying to parse them.
    const typeMatch = /^([a-zA-Z]+)\s*[{(]/u.exec(text.slice(i))
    if (!typeMatch) {
      errors.push({ line, message: 'expected @type{ after @' })
      continue
    }
    const entryType = typeMatch[1].toLowerCase()
    i += typeMatch[0].length
    if (
      entryType === 'comment' ||
      entryType === 'preamble' ||
      entryType === 'string'
    ) {
      // Skip to the matching closing brace / paren at depth 0.
      const skipEnd = findMatchingClose(text, i - 1)
      if (skipEnd < 0) {
        errors.push({ line, message: `unterminated @${entryType}` })
        i = text.length
        continue
      }
      advanceLineCounter(i, skipEnd + 1)
      i = skipEnd + 1
      continue
    }

    const entryStartLine = line
    // Citation key — everything up to the first comma.
    const commaIdx = text.indexOf(',', i)
    if (commaIdx < 0) {
      errors.push({ line, message: 'entry missing fields (no comma after key)' })
      i = text.length
      continue
    }
    const citationKey = text.slice(i, commaIdx).trim()
    advanceLineCounter(i, commaIdx)
    i = commaIdx + 1

    const fields: Record<string, string> = {}

    // Parse field list until matching close brace.
    while (i < text.length) {
      // Skip whitespace (+ track line breaks) and commas.
      while (i < text.length) {
        const ch = text[i]
        if (ch === ' ' || ch === '\t' || ch === ',') {
          i += 1
          continue
        }
        if (ch === '\n') {
          line += 1
          i += 1
          continue
        }
        break
      }
      if (i >= text.length) {
        errors.push({ line: entryStartLine, message: 'unterminated entry' })
        break
      }
      if (text[i] === '}' || text[i] === ')') {
        i += 1
        break
      }

      const fieldName = readFieldName(text, i)
      if (!fieldName) {
        errors.push({ line, message: 'could not read field name' })
        // Recover by jumping to next comma or close brace.
        i = advanceUntil(text, i, ',}')
        continue
      }
      i = fieldName.end
      i = skipWhitespace(text, i, (delta) => (line += delta))
      if (text[i] !== '=') {
        errors.push({
          line,
          message: `field "${fieldName.name}" missing = sign`,
        })
        i = advanceUntil(text, i, ',}')
        continue
      }
      i += 1
      i = skipWhitespace(text, i, (delta) => (line += delta))

      const valueRead = readFieldValue(text, i, (delta) => (line += delta))
      if (!valueRead) {
        errors.push({
          line,
          message: `field "${fieldName.name}" has no value`,
        })
        i = advanceUntil(text, i, ',}')
        continue
      }
      fields[fieldName.name.toLowerCase()] = normalizeFieldText(valueRead.value)
      i = valueRead.end
    }

    entries.push({ entryType, citationKey, fields })
  }

  return { entries, errors }
}

// ── Low-level helpers ────────────────────────────────────────────────

function readFieldName(
  text: string,
  start: number,
): { name: string; end: number } | null {
  let end = start
  while (end < text.length) {
    const ch = text[end]
    if (/[A-Za-z0-9_\-:]/.test(ch)) {
      end += 1
      continue
    }
    break
  }
  if (end === start) return null
  return { name: text.slice(start, end), end }
}

function skipWhitespace(
  text: string,
  start: number,
  onNewline: (delta: number) => void,
): number {
  let i = start
  while (i < text.length) {
    const ch = text[i]
    if (ch === ' ' || ch === '\t') {
      i += 1
      continue
    }
    if (ch === '\n') {
      onNewline(1)
      i += 1
      continue
    }
    break
  }
  return i
}

/**
 * Read a BibTeX field value starting at `start`. Handles three forms:
 *
 *   - `{...}` balanced braces (most common; preserves inner `{...}` groups)
 *   - `"..."` quoted strings (respects escaped `\"` sequences)
 *   - bare token — letters / digits / punctuation until the next `,` or `}`.
 *     This is how @string macros reference identifiers; we just keep the raw
 *     identifier text since we don't expand macros.
 *
 * Returns the raw value **with its surrounding delimiters stripped** so the
 * caller can run text normalisation without knowing which form was used.
 */
function readFieldValue(
  text: string,
  start: number,
  onNewline: (delta: number) => void,
): { value: string; end: number } | null {
  if (start >= text.length) return null
  const ch = text[start]
  if (ch === '{') {
    let depth = 1
    let i = start + 1
    const segmentStart = i
    while (i < text.length && depth > 0) {
      const c = text[i]
      if (c === '\\' && i + 1 < text.length) {
        i += 2
        continue
      }
      if (c === '{') depth += 1
      else if (c === '}') {
        depth -= 1
        if (depth === 0) break
      } else if (c === '\n') {
        onNewline(1)
      }
      i += 1
    }
    if (depth !== 0) return null
    return { value: text.slice(segmentStart, i), end: i + 1 }
  }
  if (ch === '"') {
    let i = start + 1
    const segmentStart = i
    while (i < text.length) {
      const c = text[i]
      if (c === '\\' && i + 1 < text.length) {
        i += 2
        continue
      }
      if (c === '"') break
      if (c === '\n') onNewline(1)
      i += 1
    }
    if (i >= text.length) return null
    return { value: text.slice(segmentStart, i), end: i + 1 }
  }
  // Bare token — read until comma or closing brace.
  let i = start
  while (i < text.length) {
    const c = text[i]
    if (c === ',' || c === '}' || c === '\n') break
    i += 1
  }
  const raw = text.slice(start, i).trim()
  if (!raw) return null
  return { value: raw, end: i }
}

function findMatchingClose(text: string, openIdx: number): number {
  const open = text[openIdx]
  const close = open === '{' ? '}' : ')'
  let depth = 1
  let i = openIdx + 1
  while (i < text.length) {
    const c = text[i]
    if (c === '\\' && i + 1 < text.length) {
      i += 2
      continue
    }
    if (c === open) depth += 1
    else if (c === close) {
      depth -= 1
      if (depth === 0) return i
    }
    i += 1
  }
  return -1
}

function advanceUntil(text: string, start: number, stopChars: string): number {
  let i = start
  while (i < text.length && !stopChars.includes(text[i])) i += 1
  return i
}

/**
 * Strip BibTeX-isms that survive the outer delimiter scan but aren't
 * meaningful in a plain-text library row:
 *
 *   - Inner `{...}` groups (used to protect casing like `{BaTiO}_3`) → just
 *     drop the braces, keep the content.
 *   - `\&`, `\$`, `\%` → literal characters.
 *   - Remaining backslash-LaTeX commands (`\textit{...}`, `\emph{...}`)
 *     → unwrap to content.
 *   - Collapse whitespace runs to a single space and trim.
 *
 * We don't try to be exhaustive — users can still edit the row later.
 */
function normalizeFieldText(raw: string): string {
  let text = raw
  // Unwrap simple `\cmd{content}` to `content` (iterate until stable).
  // Capped at 4 rounds to guarantee termination on adversarial input.
  for (let pass = 0; pass < 4; pass++) {
    const next = text.replace(/\\[a-zA-Z]+\{([^{}]*)\}/g, '$1')
    if (next === text) break
    text = next
  }
  // Escaped punctuation → bare char.
  text = text.replace(/\\([&$%_#])/g, '$1')
  // Drop remaining `{...}` protection groups.
  text = text.replace(/\{([^{}]*)\}/g, '$1')
  // Collapse whitespace.
  text = text.replace(/\s+/g, ' ').trim()
  return text
}

// ── Entry → library row projection ───────────────────────────────────

export interface BibTeXPaperDraft {
  title: string
  authors: string
  year: string
  doi?: string
  url?: string
  journal?: string
  abstract?: string
  notes?: string
  bibKey: string
}

/**
 * Convert a parsed `BibTeXEntry` to the shape `libraryAddPaper` expects.
 * Returns `null` when the entry has no usable title — importing a row
 * without a title produces garbage in the library list view.
 */
export function entryToPaperDraft(entry: BibTeXEntry): BibTeXPaperDraft | null {
  const title = entry.fields.title?.trim()
  if (!title) return null
  const authors = authorListToString(entry.fields.author || entry.fields.editor || '')
  const year = extractYear(entry.fields.year || entry.fields.date || '')
  const doi = extractDoi(entry.fields.doi || entry.fields.url || '')
  const url =
    entry.fields.url?.trim() ||
    (doi ? `https://doi.org/${doi}` : undefined)
  const journal =
    entry.fields.journal?.trim() ||
    entry.fields.booktitle?.trim() ||
    entry.fields.series?.trim() ||
    undefined
  const abstract = entry.fields.abstract?.trim() || undefined
  const notes = entry.fields.note?.trim() || entry.fields.annote?.trim() || undefined
  return {
    title,
    authors,
    year,
    doi: doi || undefined,
    url,
    journal,
    abstract,
    notes,
    bibKey: entry.citationKey,
  }
}

function authorListToString(raw: string): string {
  if (!raw.trim()) return ''
  // BibTeX joins multiple authors with ` and `. Preserve their original
  // order + join with `, ` which is what the library displays.
  return raw
    .split(/\s+and\s+/i)
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .join(', ')
}

function extractYear(raw: string): string {
  const match = raw.match(/\b(\d{4})\b/)
  return match ? match[1] : ''
}

function extractDoi(raw: string): string {
  // Match `10.xxxx/...` anywhere in the value. Tolerant of `doi:`,
  // `https://doi.org/`, or bare — the library normalises to bare.
  const match = raw.match(/\b10\.\d{4,9}\/[^\s,{}]+/)
  if (!match) return ''
  // Strip trailing punctuation sometimes included in citations.
  return match[0].replace(/[),.;:]+$/, '')
}
