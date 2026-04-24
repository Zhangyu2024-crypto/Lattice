// Tier 1 · unit tests for the generic table copy / export helpers.
//
// These are contract tests, not golden-string tests — we probe the
// behaviours that break in practice (null cells, quotes, commas,
// newlines, width alignment) rather than pinning exact output strings
// that would make the suite brittle to formatting nudges.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock toast so success/error don't require a renderer to mount.
vi.mock('../stores/toast-store', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

import {
  copyTable,
  downloadCsv,
  tableToCsv,
  tableToMarkdown,
  tableToTsv,
  type TableSpec,
} from './table-export'
import { toast } from '../stores/toast-store'

interface Row {
  name: string
  value: number | null
  note?: string
}

const SAMPLE: TableSpec<Row> = {
  columns: [
    { key: 'name', header: 'Name' },
    { key: 'value', header: 'Value' },
    { key: 'note', header: 'Note' },
  ],
  rows: [
    { name: 'alpha', value: 1, note: 'first' },
    { name: 'beta', value: 2.5, note: undefined },
    { name: 'gamma', value: null, note: 'final' },
  ],
  filename: 'demo',
}

// ── tableToCsv ──────────────────────────────────────────────────────

describe('tableToCsv', () => {
  it('emits header row + body rows in column order', () => {
    const csv = tableToCsv(SAMPLE)
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('Name,Value,Note')
    expect(lines[1]).toBe('alpha,1,first')
    expect(lines[2]).toBe('beta,2.5,')
    expect(lines[3]).toBe('gamma,,final')
  })

  it('escapes cells containing commas, quotes, and newlines per RFC 4180', () => {
    const spec: TableSpec<{ x: string }> = {
      columns: [{ key: 'x', header: 'X' }],
      rows: [
        { x: 'has,comma' },
        { x: 'has"quote' },
        { x: 'has\nnewline' },
      ],
    }
    const csv = tableToCsv(spec)
    expect(csv).toContain('"has,comma"')
    expect(csv).toContain('"has""quote"')
    expect(csv).toContain('"has\nnewline"')
  })

  it('applies per-column format() before serialisation', () => {
    const spec: TableSpec<Row> = {
      ...SAMPLE,
      columns: [
        { key: 'name', header: 'Name' },
        {
          key: 'value',
          header: 'Value (3dp)',
          format: (v) => (typeof v === 'number' ? v.toFixed(3) : null),
        },
      ],
      rows: [{ name: 'a', value: 1.23456, note: undefined }],
    }
    const csv = tableToCsv(spec)
    expect(csv).toContain('a,1.235')
  })

  it('still emits a valid CSV when the row list is empty (header-only)', () => {
    const empty = { ...SAMPLE, rows: [] }
    const csv = tableToCsv(empty)
    expect(csv.trim()).toBe('Name,Value,Note')
  })
})

// ── tableToTsv ──────────────────────────────────────────────────────

describe('tableToTsv', () => {
  it('uses tab as delimiter and preserves cells as-is (no quoting)', () => {
    const tsv = tableToTsv(SAMPLE)
    const lines = tsv.trim().split('\n')
    expect(lines[0]).toBe('Name\tValue\tNote')
    expect(lines[1]).toBe('alpha\t1\tfirst')
    expect(lines[2]).toBe('beta\t2.5\t')
  })

  it('flattens tab and newline characters inside cells to single spaces', () => {
    const spec: TableSpec<{ x: string }> = {
      columns: [{ key: 'x', header: 'X' }],
      rows: [{ x: 'line1\nline2' }, { x: 'a\tb' }],
    }
    const tsv = tableToTsv(spec)
    // No stray newlines inside cells — body must have exactly one
    // newline per row (end of row), plus trailing.
    expect(tsv.split('\n').filter(Boolean).length).toBe(3) // header + 2 rows
    expect(tsv).toContain('line1 line2')
    expect(tsv).toContain('a b')
  })
})

// ── tableToMarkdown ─────────────────────────────────────────────────

describe('tableToMarkdown', () => {
  it('produces a GFM table with aligned column widths', () => {
    const md = tableToMarkdown(SAMPLE)
    const lines = md.trim().split('\n')
    expect(lines).toHaveLength(2 + SAMPLE.rows.length) // header + separator + body
    // All lines share the same count of `|` separators (stable grid).
    const pipeCounts = lines.map((l) => (l.match(/\|/g) ?? []).length)
    expect(new Set(pipeCounts).size).toBe(1)
    // Separator row is all dashes between pipes.
    expect(lines[1]).toMatch(/^\| -+ \| -+ \| -+ \|$/)
  })

  it('pads the separator to at least 3 dashes per column', () => {
    const spec: TableSpec<{ a: string }> = {
      columns: [{ key: 'a', header: 'A' }],
      rows: [{ a: 'x' }],
    }
    const md = tableToMarkdown(spec)
    expect(md).toMatch(/\|\s*---\s*\|/)
  })
})

// ── copyTable ──────────────────────────────────────────────────────

describe('copyTable', () => {
  const originalClipboard = navigator.clipboard

  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => {}) },
    })
  })

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    })
  })

  it('defaults to TSV and writes to the clipboard', async () => {
    await copyTable(SAMPLE)
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1)
    const [payload] = (
      navigator.clipboard.writeText as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]
    expect(payload).toContain('\t') // TSV delimiter
    expect(payload).not.toContain('| Name |') // not Markdown
    expect(toast.success).toHaveBeenCalledWith('Copied to clipboard')
  })

  it('copies as Markdown when kind="markdown" is passed', async () => {
    await copyTable(SAMPLE, 'markdown')
    const [payload] = (
      navigator.clipboard.writeText as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]
    expect(payload).toContain('| Name')
    expect(toast.success).toHaveBeenCalledWith('Copied as Markdown')
  })

  it('fires an error toast when the Clipboard API is missing', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    })
    await copyTable(SAMPLE)
    expect(toast.error).toHaveBeenCalled()
  })
})

// ── downloadCsv ─────────────────────────────────────────────────────

describe('downloadCsv', () => {
  beforeEach(() => {
    // Stub URL.createObjectURL + <a>.click since jsdom doesn't implement
    // real downloads. We only need to verify the helper wires them up.
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mocked')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })

  it('creates a Blob URL, synthesises an <a>, and fires a toast', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click')
    downloadCsv(SAMPLE)
    expect(URL.createObjectURL).toHaveBeenCalled()
    expect(clickSpy).toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('demo.csv'))
  })

  it('appends .csv extension if the filename stem omits it', () => {
    const spec = { ...SAMPLE, filename: 'x-report' }
    downloadCsv(spec)
    expect(toast.success).toHaveBeenCalledWith('Saved x-report.csv')
  })

  it('does not double-append .csv if the caller already included it', () => {
    const spec = { ...SAMPLE, filename: 'already.csv' }
    downloadCsv(spec)
    expect(toast.success).toHaveBeenCalledWith('Saved already.csv')
  })
})
