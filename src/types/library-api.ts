// Types for /api/library/* endpoints exposed by the lattice-cli backend.
// Request/response shapes are derived from the actual FastAPI handler
// bodies at `src/lattice_cli/web/server.py` and the underlying state_bridge
// + ref_library.py — NOT from any secondhand report.

// ─── Paper ─────────────────────────────────────────────────────────

/** Paper row as returned by ReferenceLibrary.get_paper() / list_recent().
 *  Shape mirrors the `papers` SQLite table at
 *  `src/lattice_cli/ref_library.py:83-137`. */
export interface LibraryPaperRow {
  id: number
  title: string
  title_norm?: string
  /** Authors are stored as a single semicolon-separated string. */
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
  zotero_key?: string
  /** Added by state_bridge.get_library_papers after the SQL query. */
  tags?: string[]
  /** Added by state_bridge.get_library_papers. */
  collections?: string[]
  /** Added by state_bridge.enrich_papers_with_knowledge — optional. */
  chain_count?: number
  extractions?: number
}

export interface LibraryPapersQuery {
  q?: string
  tag?: string
  year?: string
  collection?: string
  page?: number
  limit?: number
  sort?: 'updated_at' | 'year' | 'title' | 'authors' | 'id'
  order?: 'asc' | 'desc'
}

export interface LibraryPapersResponse {
  papers: LibraryPaperRow[]
  total: number
}

// ─── Manual add / update ───────────────────────────────────────────

/** Any subset of the whitelisted keys in state_bridge.add_library_paper()
 *  at line 788 — `title | authors | year | doi | url | journal | abstract |
 *  notes | tags | collection`. */
export interface AddPaperRequest {
  title: string
  authors: string
  year?: string
  doi?: string
  url?: string
  journal?: string
  abstract?: string
  notes?: string
  tags?: string[]
  collection?: string
}

export type AddPaperResponse =
  | { success: true; id: number }
  | { success: false; id?: number; error?: string }

export interface UpdatePaperRequest {
  title?: string
  authors?: string
  year?: string
  doi?: string
  url?: string
  journal?: string
  abstract?: string
  notes?: string
  citation_count?: number
  bib_key?: string
}

export type UpdatePaperResponse = { success: boolean; error?: string }

// ─── DOI import ────────────────────────────────────────────────────

export interface AddByDoiRequest {
  doi: string
}

export type AddByDoiResponse =
  | { success: true; paper: LibraryPaperRow }
  | { success: false; error: string }

// ─── Delete ────────────────────────────────────────────────────────

export type DeletePaperResponse = { success: boolean; error?: string }

// ─── Tags ──────────────────────────────────────────────────────────

export interface LibraryTag {
  name: string
  count: number
}

export type LibraryTagsResponse = LibraryTag[]

export interface AddTagRequest {
  tag: string
}

export type AddTagResponse = { success: boolean; error?: string }
export type RemoveTagResponse = { success: boolean; error?: string }

// ─── Collections ───────────────────────────────────────────────────

export interface LibraryCollection {
  name: string
  description: string
  count: number
}

export type LibraryCollectionsResponse = LibraryCollection[]

export interface CreateCollectionRequest {
  name: string
  description?: string
}

export type CreateCollectionResponse =
  | { success: true; id: number }
  | { success: false; error: string }

export type DeleteCollectionResponse = { success: boolean }
export type AddToCollectionResponse = { success: boolean }
export type RemoveFromCollectionResponse = { success: boolean }

// ─── Stats ─────────────────────────────────────────────────────────

export interface LibraryStats {
  total_papers: number
  total_tags: number
  tag_count: number
  collection_count: number
  by_source: Record<string, number>
  by_year: Record<string, number>
}

// ─── Import / Export ───────────────────────────────────────────────

export type ImportBibtexResponse =
  | { success: true; imported: number }
  | { success: false; error: string }

export type ImportRisResponse =
  | { success: true; imported: number }
  | { success: false; error: string }

// (export bibtex returns a file body, not JSON — handled specially in the hook)

// ─── Full-text / extractions / chains ─────────────────────────────

export interface PaperReadSection {
  title: string
  level?: number
  content: string
}

export type PaperReadResponse =
  | {
      success: true
      paper_id?: number
      title?: string
      authors?: string
      year?: string | number
      journal?: string
      doi?: string
      page_count?: number
      sections: PaperReadSection[]
      full_text: string
      /** "local_pdf" | "online (...)" | other backend-defined tags. */
      source?: string
    }
  | { success: false; error: string }

// ─── RAG (paper-level + multi) ─────────────────────────────────────

export interface AskPaperRequest {
  question: string
  page?: number
  images?: string[]
}

export interface RagSource {
  paper_id?: number
  title?: string
  page?: number
  excerpt?: string
}

export type AskPaperResponse =
  | { success: true; answer: string; sources: RagSource[] }
  | { success: false; error: string }

export interface AskMultiRequest {
  paper_ids: number[]
  question: string
  images?: string[]
}

// Backend returns aggregated answer + per-paper answers; sources is not part
// of the cross-paper response (only single-paper /ask carries RagSource[]).
export type AskMultiResponse =
  | {
      success: true
      answer: string
      per_paper: string[]
      paper_count: number
    }
  | { success: false; error: string }

// ─── Annotations ───────────────────────────────────────────────────

/** PDF annotation subtypes.
 *  - `highlight` — filled rect tint
 *  - `note`      — sticky-note pill anchored to the first rect + sidebar text
 *  - `underline` — bottom-border rect, transparent fill
 *  - `strike`    — line-through rect
 *  - `todo`      — highlight tint + checkbox badge; `todoDone` tracks state
 *
 *  Kept as a `string` union so older on-disk rows with unknown values still
 *  load (forward-compat), and so a future P3 addition like `'comment'` can
 *  land without a schema version bump. */
export type PaperAnnotationType =
  | 'highlight'
  | 'note'
  | 'underline'
  | 'strike'
  | 'todo'
  | string

export interface PaperAnnotation {
  id: number
  paper_id: number
  page: number
  type: PaperAnnotationType
  color: string
  content: string
  rects: Array<{ x: number; y: number; width: number; height: number }>
  created_at?: string
  /** Short user-assigned label. Surfaced in the annotations list + filters;
   *  optional so old rows still typecheck. */
  label?: string
  /** Free-form tags for categorization / cross-filtering. */
  tags?: string[]
  /** Back-link to a composer mention that was created from this annotation —
   *  lets the chat "pdf-quote" chip jump back to the right spot. */
  linkedMentionRef?: string
  /** Only meaningful when `type === 'todo'`. Tracks checkbox state. */
  todoDone?: boolean
}

export type PaperAnnotationsResponse = PaperAnnotation[]

export interface AddAnnotationRequest {
  page: number
  type?: PaperAnnotationType
  color?: string
  content?: string
  rects?: Array<{ x: number; y: number; width: number; height: number }>
  label?: string
  tags?: string[]
  linkedMentionRef?: string
  todoDone?: boolean
}

export type AddAnnotationResponse =
  | { success: true; id: number }
  | { success: false; error: string }

export interface UpdateAnnotationRequest {
  page?: number
  color?: string
  content?: string
  rects?: PaperAnnotation['rects']
  label?: string
  tags?: string[]
  /** Toggle for `type='todo'` annotations. */
  todoDone?: boolean
}

export type UpdateAnnotationResponse = { success: boolean }
export type DeleteAnnotationResponse = { success: boolean }

// ─── Scan ──────────────────────────────────────────────────────────

export interface ScanDirectoryRequest {
  directory?: string
  extract?: boolean
}

export type ScanDirectoryResponse =
  | {
      success: true
      added: number
      extracted?: number
      /** Count of .pdf files discovered during the walk (pre-import).
       *  The UI can show "scanned N, added X" so a "0 added" result is
       *  unambiguous — zero scanned means no PDFs in the tree, while
       *  scanned > 0 + added < scanned means some imports failed. */
      scanned?: number
      errors?: string[]
    }
  | { success: false; error: string }

// ─── Direct PDF upload ─────────────────────────────────────────────

export interface UploadPdfRequest {
  /** Absolute path on the user's disk (from native file picker). The
   *  Electron main process copies it into the app-owned library dir. */
  sourcePath: string
  collection?: string
  tags?: string[]
}

export type UploadPdfResponse =
  | { success: true; id: number; deduped: boolean }
  | { success: false; error: string }
