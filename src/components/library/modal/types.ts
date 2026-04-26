// Shared types for the LibraryModal 3-pane layout.
//
// Extracted from LibraryModal.tsx so the pane sub-components (CollectionsPane,
// MiddlePane, DetailsPane) can share a single definition rather than each
// re-declaring the same shapes.

export const ALL_PAPERS_ID = '__all__'

export type PaperCard = {
  // Client-side id. For local library papers it's the stringified int id; for demo
  // papers it's the raw demo string id. Always stable per row.
  id: string
  backendId: number | null
  title: string
  authors: string[]
  year: string
  venue: string
  doi?: string
  abstract: string
  tags: string[]
  collections: string[]
  chainCount: number
  pdfPath?: string | null
  /** Demo / inline PDF URL when `paperId` is not a local library integer. */
  pdfUrl?: string | null
}

export interface Collection {
  id: string
  name: string
  description?: string
  paperCount: number
}
