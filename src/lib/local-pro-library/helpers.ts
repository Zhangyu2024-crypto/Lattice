// Shared internals for the split `local-pro-library` implementation.
// The main module re-exports nothing from here; these helpers are private
// to the package split.

import type { LibraryPaperRow, PaperAnnotation } from '../../types/library-api'

export const IPC_UNAVAILABLE =
  'Library IPC unavailable — restart the desktop app.'
export const NOT_IMPLEMENTED_LOCALLY =
  'Not implemented in the local library yet — pending a future self-contained-port phase.'

export function electron() {
  return window.electronAPI
}

/** IPC rows ship optional arrays; normalize so downstream iteration is
 *  safe. Keeps the strict `LibraryPaperRow` consumer signature intact. */
export function normalizeRow(row: {
  id: number
  title: string
  title_norm?: string
  authors: string
  year: string
  doi?: string
  url?: string
  journal?: string
  abstract?: string
  source?: string
  citation_count?: number
  bib_key?: string
  notes?: string
  pdf_path?: string
  created_at?: string
  updated_at?: string
  tags?: string[]
  collections?: string[]
}): LibraryPaperRow {
  return {
    id: row.id,
    title: row.title,
    title_norm: row.title_norm,
    authors: row.authors,
    year: row.year,
    doi: row.doi,
    url: row.url,
    journal: row.journal,
    abstract: row.abstract,
    source: row.source,
    citation_count: row.citation_count,
    bib_key: row.bib_key,
    notes: row.notes,
    pdf_path: row.pdf_path,
    created_at: row.created_at,
    updated_at: row.updated_at,
    tags: row.tags ?? [],
    collections: row.collections ?? [],
  }
}

export function normalizeAnnotation(row: {
  id: number
  paper_id: number
  page: number
  type: string
  color: string
  content: string
  rects: Array<{ x: number; y: number; width: number; height: number }>
  created_at?: string
}): PaperAnnotation {
  return {
    id: row.id,
    paper_id: row.paper_id,
    page: row.page,
    type: row.type,
    color: row.color,
    content: row.content,
    rects: row.rects ?? [],
    created_at: row.created_at,
  }
}

export function requireIpc<
  K extends keyof NonNullable<ReturnType<typeof electron>>,
>(method: K): NonNullable<NonNullable<ReturnType<typeof electron>>[K]> {
  const api = electron()
  const fn = api?.[method]
  if (!fn) throw new Error(IPC_UNAVAILABLE)
  return fn as NonNullable<NonNullable<ReturnType<typeof electron>>[K]>
}
