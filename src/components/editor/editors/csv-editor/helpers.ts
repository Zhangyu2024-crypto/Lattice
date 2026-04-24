/**
 * Parser + column-inference helpers for the CSV editor.
 *
 * These functions are intentionally pure and UI-free so they can be unit
 * tested in isolation and reused if we add a batch/preview path later.
 */

/** Shape returned by {@link parseCsv}. */
export interface ParsedCsv {
  headers: string[]
  rows: string[][]
  /** True when the parser stopped early at `PARSE_MAX_ROWS`. */
  truncated: boolean
  /** Number of non-empty data lines in the original text (pre-cap). */
  totalLines: number
}

/**
 * Guess the delimiter from the first non-empty line. Defaults to comma;
 * upgrades to tab or semicolon when those are more common.
 */
export function detectDelimiter(firstLine: string): string {
  if (firstLine.includes('\t')) return '\t'
  if (firstLine.includes(';')) {
    const commas = (firstLine.match(/,/g) ?? []).length
    const semis = (firstLine.match(/;/g) ?? []).length
    return semis > commas ? ';' : ','
  }
  return ','
}

// Cap the parse at a bounded row count. The DataTable only renders the
// first `MAX_ROWS` rows anyway; parsing everything up-front on a 100k-row
// CSV froze the main thread for several seconds and allocated ~10× the
// file size in transient string arrays. `PARSE_MAX_ROWS` is a little
// larger than the render cap so column-type inference (`findNumericColumns`)
// still has a reasonable sample window.
export const PARSE_MAX_ROWS = 5000

export function parseCsv(text: string, delimiter: string): ParsedCsv {
  const lines = text.split(/\r?\n/)
  const firstDataIdx = lines.findIndex((l) => l.trim().length > 0)
  if (firstDataIdx < 0) {
    return { headers: [], rows: [], truncated: false, totalLines: 0 }
  }
  const headers = lines[firstDataIdx].split(delimiter).map((h) => h.trim())
  const rows: string[][] = []
  let seenNonEmpty = 0
  for (let i = firstDataIdx + 1; i < lines.length; i++) {
    const raw = lines[i]
    if (!raw.trim()) continue
    seenNonEmpty++
    if (rows.length >= PARSE_MAX_ROWS) continue
    rows.push(raw.split(delimiter).map((c) => c.trim()))
  }
  return {
    headers,
    rows,
    truncated: seenNonEmpty > PARSE_MAX_ROWS,
    totalLines: seenNonEmpty,
  }
}

/**
 * Column-index heuristic: a column is considered numeric when at least
 * half of its first 20 sampled rows parse as finite numbers.
 */
export function findNumericColumns(
  headers: string[],
  rows: string[][],
): number[] {
  return headers
    .map((_, i) => i)
    .filter((i) => {
      let numCount = 0
      for (let r = 0; r < Math.min(rows.length, 20); r++) {
        if (rows[r][i] !== undefined && Number.isFinite(Number(rows[r][i]))) {
          numCount++
        }
      }
      return numCount >= Math.min(rows.length, 20) * 0.5
    })
}
