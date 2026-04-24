// LocalProLibrary — drop-in replacement for the subset of `useLibraryApi`
// that `LibraryModal` consumes. Self-contained Port Plan §P3.
//
// Storage: JSON file at `app.getPath('userData')/library/library.json`
// via `window.electronAPI.library*` IPC. Methods marked "Not implemented
// locally" are stubbed to return a descriptive error — the lattice-cli
// backend supplies them in the legacy REST client and a future phase
// will port each one (DOI lookup, BibTeX / RIS parsing, PDF scan, full-
// text search, RAG).
//
// Implementation is split across `./local-pro-library/*`; this file
// composes the parts into a single `localProLibrary` object so existing
// consumers keep their `import { localProLibrary } from
// '.../local-pro-library'` line unchanged.

import type {
  AddAnnotationRequest,
  AddAnnotationResponse,
  AddByDoiRequest,
  AddByDoiResponse,
  AddPaperRequest,
  AddPaperResponse,
  AddTagResponse,
  AskMultiRequest,
  AskMultiResponse,
  AskPaperRequest,
  AskPaperResponse,
  CreateCollectionRequest,
  CreateCollectionResponse,
  DeleteAnnotationResponse,
  DeleteCollectionResponse,
  DeletePaperResponse,
  ImportBibtexResponse,
  ImportRisResponse,
  LibraryCollectionsResponse,
  LibraryPapersQuery,
  LibraryPapersResponse,
  LibraryStats,
  LibraryTagsResponse,
  PaperAnnotationsResponse,
  PaperChainsResponse,
  PaperExtractionsResponse,
  PaperReadResponse,
  RemoveTagResponse,
  ScanDirectoryRequest,
  ScanDirectoryResponse,
  UpdateAnnotationRequest,
  UpdateAnnotationResponse,
  UploadPdfRequest,
  UploadPdfResponse,
} from '../types/library-api'
import { electron } from './local-pro-library/helpers'
import {
  addPaper,
  addTag,
  addToCollection,
  createCollection,
  deleteCollection,
  deletePaper,
  listCollections,
  listPapers,
  listTags,
  removeFromCollection,
  removeTag,
  stats,
} from './local-pro-library/papers'
import {
  addAnnotation,
  deleteAnnotation,
  listAnnotations,
  updateAnnotation,
} from './local-pro-library/annotations'
import {
  askMulti,
  askPaper,
  paperChains,
  paperExtractions,
  pdfBytes,
  pdfUrl,
  readPaper,
} from './local-pro-library/rag'
import {
  addPaperByDoi,
  exportBibtex,
  importBibtex,
  importRis,
  scan,
  uploadPdf,
} from './local-pro-library/import-export'

export interface LocalLibraryApi {
  readonly ready: boolean

  listPapers: (q?: LibraryPapersQuery) => Promise<LibraryPapersResponse>
  addPaper: (req: AddPaperRequest) => Promise<AddPaperResponse>
  deletePaper: (id: number) => Promise<DeletePaperResponse>

  listTags: () => Promise<LibraryTagsResponse>
  addTag: (paperId: number, tag: string) => Promise<AddTagResponse>
  removeTag: (paperId: number, tag: string) => Promise<RemoveTagResponse>

  listCollections: () => Promise<LibraryCollectionsResponse>
  createCollection: (
    req: CreateCollectionRequest,
  ) => Promise<CreateCollectionResponse>
  deleteCollection: (name: string) => Promise<DeleteCollectionResponse>
  addToCollection: (name: string, paperId: number) => Promise<{ success: boolean }>
  removeFromCollection: (
    name: string,
    paperId: number,
  ) => Promise<{ success: boolean }>

  stats: () => Promise<LibraryStats>

  // Annotations (P3 v3 — local, persistent)
  listAnnotations: (paperId: number) => Promise<PaperAnnotationsResponse>
  addAnnotation: (
    paperId: number,
    req: AddAnnotationRequest,
  ) => Promise<AddAnnotationResponse>
  updateAnnotation: (
    annId: number,
    req: UpdateAnnotationRequest,
  ) => Promise<UpdateAnnotationResponse>
  deleteAnnotation: (annId: number) => Promise<DeleteAnnotationResponse>

  // PDF / RAG / chains / extractions — stubbed. P4 (Python worker) is
  // the planned delivery channel for these; until then the methods throw
  // or return explicit "not available" responses so UI can surface a
  // clear hint rather than hanging on an undefined response shape.
  /**
   * Resolve a `blob:` URL the renderer can hand to pdfjs. Asynchronous
   * because we round-trip through IPC to read bytes from the app-owned
   * pdfs dir; returns `null` when the paper has no PDF attached or the
   * file on disk disappeared. Callers are responsible for revoking the
   * URL via `URL.revokeObjectURL` on unmount / id change.
   */
  pdfUrl: (paperId: number) => Promise<string | null>
  /**
   * Resolve the raw PDF bytes — intended for `pdfjs.getDocument({data})`
   * so the worker receives the PDF via postMessage and does not need to
   * do any cross-origin fetch (our worker is spawned from a blob-origin
   * polyfill wrapper; fetching an http/blob URL from that realm is a
   * well-known failure mode). Returns `null` on any backend error
   * (missing IPC, no pdf_path, oversized file, etc.).
   */
  pdfBytes: (paperId: number) => Promise<ArrayBuffer | null>
  readPaper: (id: number) => Promise<PaperReadResponse>
  paperExtractions: (id: number) => Promise<PaperExtractionsResponse>
  paperChains: (id: number) => Promise<PaperChainsResponse>
  askPaper: (id: number, req: AskPaperRequest) => Promise<AskPaperResponse>
  askMulti: (req: AskMultiRequest) => Promise<AskMultiResponse>

  // Stubs — flag deferred backend features so callers see a clear reason
  // instead of a generic "network error".
  addPaperByDoi: (req: AddByDoiRequest) => Promise<AddByDoiResponse>
  importBibtex: (file: File) => Promise<ImportBibtexResponse>
  importRis: (file: File, collection?: string) => Promise<ImportRisResponse>
  exportBibtex: (opts?: {
    tag?: string
    collection?: string
  }) => Promise<string>
  scan: (req: ScanDirectoryRequest) => Promise<ScanDirectoryResponse>
  /** Copy a single PDF from the user's disk into the app library and
   *  create a row for it (title from filename; metadata left blank so
   *  the user can enrich later via "Add by DOI" or manual edit). */
  uploadPdf: (req: UploadPdfRequest) => Promise<UploadPdfResponse>
}

export const localProLibrary: LocalLibraryApi = {
  get ready(): boolean {
    // Ready whenever the IPC surface is attached — storage is lazy-created
    // on first write. A pure-Vite dev run has no electronAPI, so the
    // legacy `!ready` fallback paths in callers still apply there.
    return Boolean(electron()?.libraryListPapers)
  },

  listPapers,
  addPaper,
  deletePaper,

  listTags,
  addTag,
  removeTag,

  listCollections,
  createCollection,
  deleteCollection,
  addToCollection,
  removeFromCollection,

  stats,

  listAnnotations,
  addAnnotation,
  updateAnnotation,
  deleteAnnotation,

  pdfUrl,
  pdfBytes,
  readPaper,
  paperExtractions,
  paperChains,
  askPaper,
  askMulti,

  addPaperByDoi,
  importBibtex,
  importRis,
  exportBibtex,
  scan,
  uploadPdf,
}
