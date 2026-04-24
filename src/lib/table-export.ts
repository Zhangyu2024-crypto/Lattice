// Generic table copy / export helpers.
//
// Higher-level façade over `pro-export.ts#rowsToCsv`. Lets callers
// describe a table once (columns + rows + filename) and then copy it to
// the clipboard as TSV or Markdown, or download it as a CSV file. The
// same `TableSpec<T>` then flows into the shared `<TableActions>` UI
// primitive so every copy/download button in the app shares the exact
// same serialization rules.
//
// Design choice: TSV is the default clipboard format (Excel / Sheets /
// macOS Numbers all auto-split tab-separated clipboard data on paste,
// including locales where Excel maps CSV paste to a different delimiter).
// Markdown is a secondary "copy as" action for pasting into docs.

import { rowsToCsv, downloadTextFile } from './pro-export'
import { toast } from '../stores/toast-store'

/** Single cell value a table can carry. Anything else is stringified via
 *  `String(value)` inside the serializer. */
export type TableCell = string | number | boolean | null | undefined

/**
 * Column descriptor keyed on a specific property of `T`. The generic
 * `K` lets `format`'s `value` parameter be typed precisely against
 * that property (not the union of all values across T), so callers
 * get IDE completion + correct narrowing on per-column formatters.
 */
export interface TableColumnFor<T, K extends keyof T & string = keyof T & string> {
  key: K
  header: string
  format?: (value: T[K], row: T) => TableCell
}

/**
 * Distributive union — `TableColumn<T>` becomes the union of
 * `TableColumnFor<T, K>` for every string key K of T. Arrays typed as
 * `TableColumn<T>[]` can then mix columns for different keys, each
 * with its own `format` signature.
 */
export type TableColumn<T> = {
  [K in keyof T & string]: TableColumnFor<T, K>
}[keyof T & string]

export interface TableSpec<T> {
  columns: ReadonlyArray<TableColumn<T>>
  rows: ReadonlyArray<T>
  /**
   * Filename stem (no extension) used by `downloadCsv`. The ISO timestamp
   * is NOT appended here — callers that want one should include it in
   * the stem or pipe through `snapshotFilename()` from `pro-export.ts`.
   */
  filename?: string
}

// ── Internal cell normalisation ─────────────────────────────────────

function cellAt<T>(column: TableColumn<T>, row: T): TableCell {
  const raw = row[column.key] as T[keyof T & string]
  if (column.format) return column.format(raw, row)
  return raw as unknown as TableCell
}

function cellToString(value: TableCell): string {
  if (value == null) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return value
}

// ── Serializers ─────────────────────────────────────────────────────

/**
 * RFC 4180 CSV. Delegates the actual escaping to `rowsToCsv` in
 * pro-export so the project has a single CSV escape implementation.
 */
export function tableToCsv<T>(spec: TableSpec<T>): string {
  // Pre-apply `format` + string-normalise so rowsToCsv's escape sees
  // plain strings and doesn't re-escape numeric types.
  const flattened = spec.rows.map((row) => {
    const out: Record<string, string> = {}
    for (const col of spec.columns) {
      out[col.key] = cellToString(cellAt(col, row))
    }
    return out
  })
  return rowsToCsv(
    flattened,
    spec.columns.map((c) => ({ key: c.key, header: c.header })),
  )
}

/**
 * Tab-separated values. No escape rules — tabs inside cells are
 * replaced with spaces and newlines collapsed to spaces so one row is
 * always one line. This is intentional: TSV has no quoting convention
 * that spreadsheet apps agree on; keeping cells single-line is the
 * pragmatic contract.
 */
export function tableToTsv<T>(spec: TableSpec<T>): string {
  const sanitize = (s: string) => s.replace(/[\t\r\n]+/g, ' ')
  const head = spec.columns.map((c) => sanitize(c.header)).join('\t')
  const body = spec.rows
    .map((row) =>
      spec.columns
        .map((col) => sanitize(cellToString(cellAt(col, row))))
        .join('\t'),
    )
    .join('\n')
  return body.length === 0 ? head + '\n' : head + '\n' + body + '\n'
}

/**
 * GFM Markdown table with column-width alignment. Header cells are
 * padded to the widest content in each column so the raw text looks
 * tidy even before rendering; consumers pasting into GitHub / Linear /
 * any markdown editor get a real table either way.
 */
export function tableToMarkdown<T>(spec: TableSpec<T>): string {
  const headerCells = spec.columns.map((c) => c.header)
  const bodyCells = spec.rows.map((row) =>
    spec.columns.map((col) => cellToString(cellAt(col, row))),
  )
  // Compute per-column width (content length, no wrapping).
  const widths = spec.columns.map((_, colIdx) => {
    let w = headerCells[colIdx].length
    for (const r of bodyCells) {
      if (r[colIdx].length > w) w = r[colIdx].length
    }
    // Markdown separator needs at least 3 dashes → cell width ≥ 3.
    return Math.max(w, 3)
  })
  const pad = (cell: string, i: number) =>
    cell + ' '.repeat(widths[i] - cell.length)
  const headerRow = `| ${headerCells.map((c, i) => pad(c, i)).join(' | ')} |`
  const separatorRow = `| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`
  const bodyRows = bodyCells
    .map((r) => `| ${r.map((c, i) => pad(c, i)).join(' | ')} |`)
    .join('\n')
  return bodyRows.length === 0
    ? `${headerRow}\n${separatorRow}\n`
    : `${headerRow}\n${separatorRow}\n${bodyRows}\n`
}

// ── Action helpers ─────────────────────────────────────────────────

/** Download the table as a `.csv` file. `filename` stem comes from
 *  `spec.filename` or falls back to `"table"`. Fires a success toast. */
export function downloadCsv<T>(spec: TableSpec<T>): void {
  const csv = tableToCsv(spec)
  const stem = (spec.filename ?? 'table').replace(/\.csv$/i, '')
  const full = `${stem}.csv`
  downloadTextFile(full, csv, 'text/csv;charset=utf-8')
  toast.success(`Saved ${full}`)
}

/** Copy the table to the system clipboard. `kind` selects TSV (default,
 *  paste-into-Excel) vs Markdown (paste-into-docs). Success + failure
 *  are surfaced via toast so the user gets closure either way. */
export async function copyTable<T>(
  spec: TableSpec<T>,
  kind: 'tsv' | 'markdown' = 'tsv',
): Promise<void> {
  const text = kind === 'markdown' ? tableToMarkdown(spec) : tableToCsv(spec)
  // Pull the TSV path separately — the 'markdown' branch above handles
  // that itself. Default TSV wins because that's the spreadsheet-paste
  // common case the button surface optimises for.
  const payload = kind === 'tsv' ? tableToTsv(spec) : text
  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error('Clipboard API unavailable')
    }
    await navigator.clipboard.writeText(payload)
    toast.success(
      kind === 'markdown' ? 'Copied as Markdown' : 'Copied to clipboard',
    )
  } catch (err) {
    toast.error(
      `Copy failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}
