// DOM → TableSpec adapter for "copy / export this rendered table" paths
// where the table came from markdown rendering (chat messages, research
// reports) and the spec has to be derived at click-time from the live
// DOM instead of from typed payload state.
//
// Minimal and intentionally forgiving — `textContent` absorbs any
// nested markup (strong, code, em) into plain text. If the chat model
// emitted a real <table>, this produces a clean spec; otherwise the
// caller falls back to a toast.

import type { TableSpec } from './table-export'

type DomRow = Record<string, string>

/**
 * Walk a rendered `<table>` DOM node → generic `TableSpec`. Columns
 * come from the first `<thead><tr>` (or the first `<tr>` if no
 * explicit thead). Body rows come from `<tbody><tr>` or any `<tr>`
 * after the header.
 *
 * Returns `null` when the table has no header cells — in that case
 * there's no sensible column list to expose.
 */
export function specFromTableElement(
  el: HTMLTableElement,
  opts?: { filename?: string },
): TableSpec<DomRow> | null {
  const headerRow =
    el.querySelector('thead tr') ?? el.querySelector('tr')
  if (!headerRow) return null
  const headerCells = Array.from(headerRow.querySelectorAll<HTMLElement>('th, td'))
  if (headerCells.length === 0) return null
  const headers = headerCells.map(
    (cell, i) => (cell.textContent ?? '').trim() || `col_${i + 1}`,
  )
  // Dedup keys so `{a, a}` headers don't collide in the row object.
  const seen = new Map<string, number>()
  const keys = headers.map((h) => {
    const count = seen.get(h) ?? 0
    seen.set(h, count + 1)
    return count === 0 ? h : `${h}_${count + 1}`
  })

  const bodyRowsSource = el.querySelectorAll('tbody tr')
  const bodyRows =
    bodyRowsSource.length > 0
      ? Array.from(bodyRowsSource)
      : Array.from(el.querySelectorAll('tr')).slice(1)

  const rows: DomRow[] = bodyRows.map((tr) => {
    const cells = Array.from(tr.querySelectorAll<HTMLElement>('th, td'))
    const row: DomRow = {}
    keys.forEach((key, i) => {
      row[key] = (cells[i]?.textContent ?? '').trim()
    })
    return row
  })

  const columns = keys.map((key, i) => ({
    key,
    header: headers[i],
  }))

  return {
    columns,
    rows,
    filename: opts?.filename ?? 'chat-table',
  }
}
