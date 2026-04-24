// Typed client for `/api/library/*` endpoints.
//
// Same conventions as `useProApi.ts`: the hook reads `backend` state from
// `app-store`, attaches the bearer token, and returns a memoised bundle.
// All methods reject (not resolve) on non-2xx. `uploadBibtex`/`uploadRis`
// are the only multipart endpoints.

import { useMemo } from 'react'
import { useBackendFetch, type BackendFetchErrors } from './useBackendFetch'
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
  LibraryPaperRow,
  LibraryPapersQuery,
  LibraryPapersResponse,
  LibraryStats,
  LibraryTagsResponse,
  PaperAnnotationsResponse,
  PaperReadResponse,
  RemoveTagResponse,
  ScanDirectoryRequest,
  ScanDirectoryResponse,
  UpdateAnnotationRequest,
  UpdateAnnotationResponse,
  UpdatePaperRequest,
  UpdatePaperResponse,
} from '../types/library-api'

export class LibraryApiError extends Error {
  readonly status: number
  readonly body: string
  constructor(message: string, status: number, body: string) {
    super(message)
    this.name = 'LibraryApiError'
    this.status = status
    this.body = body
  }
}

export class LibraryBackendNotReadyError extends Error {
  constructor() {
    super('Backend not connected — Library API unavailable')
    this.name = 'LibraryBackendNotReadyError'
  }
}

export interface LibraryApi {
  // Papers
  listPapers: (q?: LibraryPapersQuery) => Promise<LibraryPapersResponse>
  getPaper: (id: number) => Promise<LibraryPaperRow>
  addPaper: (req: AddPaperRequest) => Promise<AddPaperResponse>
  addPaperByDoi: (req: AddByDoiRequest) => Promise<AddByDoiResponse>
  updatePaper: (
    id: number,
    req: UpdatePaperRequest,
  ) => Promise<UpdatePaperResponse>
  deletePaper: (id: number) => Promise<DeletePaperResponse>

  // Tags
  listTags: () => Promise<LibraryTagsResponse>
  addTag: (paperId: number, tag: string) => Promise<AddTagResponse>
  removeTag: (paperId: number, tag: string) => Promise<RemoveTagResponse>

  // Stats
  stats: () => Promise<LibraryStats>

  // Collections
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

  // Import / export
  importBibtex: (file: File) => Promise<ImportBibtexResponse>
  importRis: (file: File, collection?: string) => Promise<ImportRisResponse>
  /** Returns the bibtex file contents as a string for client-side download. */
  exportBibtex: (opts?: { tag?: string; collection?: string }) => Promise<string>

  // Reading / RAG
  readPaper: (id: number) => Promise<PaperReadResponse>
  askPaper: (
    id: number,
    req: AskPaperRequest,
  ) => Promise<AskPaperResponse>
  askMulti: (req: AskMultiRequest) => Promise<AskMultiResponse>

  // Annotations
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

  // Scan
  scan: (req: ScanDirectoryRequest) => Promise<ScanDirectoryResponse>

  // Helpers
  /**
   * Resolve a `blob:` URL the renderer can hand to pdfjs. The remote
   * implementation `rawFetch`es the REST endpoint (attaches the bearer
   * token — incidentally fixes the auth hole the old sync variant had)
   * and wraps the bytes in a Blob; callers must revoke the URL on
   * unmount / paper change.
   */
  pdfUrl: (paperId: number) => Promise<string | null>
  readonly ready: boolean
}

// Shared across all `useLibraryApi` instances so `useBackendFetch`'s
// memoised callbacks stay referentially stable.
const LIBRARY_FETCH_ERRORS: BackendFetchErrors = {
  notReady: () => new LibraryBackendNotReadyError(),
  http: (message, status, body) => new LibraryApiError(message, status, body),
}

export function useLibraryApi(): LibraryApi {
  const { jsonFetch, rawFetch, multipartFetch, ready } = useBackendFetch(
    LIBRARY_FETCH_ERRORS,
  )

  return useMemo<LibraryApi>(() => {
    const buildQuery = (q?: Record<string, unknown>): string => {
      if (!q) return ''
      const sp = new URLSearchParams()
      for (const [k, v] of Object.entries(q)) {
        if (v == null || v === '') continue
        sp.set(k, String(v))
      }
      const s = sp.toString()
      return s ? `?${s}` : ''
    }

    return {
      listPapers: (q) =>
        jsonFetch<LibraryPapersResponse>(
          `/api/library/papers${buildQuery(q as Record<string, unknown>)}`,
        ),
      getPaper: (id) =>
        jsonFetch<LibraryPaperRow>(`/api/library/paper/${id}`),
      addPaper: (req) =>
        jsonFetch<AddPaperResponse>('/api/library/papers', {
          method: 'POST',
          body: JSON.stringify(req),
        }),
      addPaperByDoi: (req) =>
        jsonFetch<AddByDoiResponse>('/api/library/papers/doi', {
          method: 'POST',
          body: JSON.stringify(req),
        }),
      updatePaper: (id, req) =>
        jsonFetch<UpdatePaperResponse>(`/api/library/papers/${id}`, {
          method: 'PUT',
          body: JSON.stringify(req),
        }),
      deletePaper: (id) =>
        jsonFetch<DeletePaperResponse>(`/api/library/papers/${id}`, {
          method: 'DELETE',
        }),

      listTags: () => jsonFetch<LibraryTagsResponse>('/api/library/tags'),
      addTag: (paperId, tag) =>
        jsonFetch<AddTagResponse>(`/api/library/papers/${paperId}/tags`, {
          method: 'POST',
          body: JSON.stringify({ tag }),
        }),
      removeTag: (paperId, tag) =>
        jsonFetch<RemoveTagResponse>(
          `/api/library/papers/${paperId}/tags/${encodeURIComponent(tag)}`,
          { method: 'DELETE' },
        ),

      stats: () => jsonFetch<LibraryStats>('/api/library/stats'),

      listCollections: () =>
        jsonFetch<LibraryCollectionsResponse>('/api/library/collections'),
      createCollection: (req) =>
        jsonFetch<CreateCollectionResponse>('/api/library/collections', {
          method: 'POST',
          body: JSON.stringify(req),
        }),
      deleteCollection: (name) =>
        jsonFetch<DeleteCollectionResponse>(
          `/api/library/collections/${encodeURIComponent(name)}`,
          { method: 'DELETE' },
        ),
      addToCollection: (name, paperId) =>
        jsonFetch<{ success: boolean }>(
          `/api/library/collections/${encodeURIComponent(name)}/papers/${paperId}`,
          { method: 'POST', body: '{}' },
        ),
      removeFromCollection: (name, paperId) =>
        jsonFetch<{ success: boolean }>(
          `/api/library/collections/${encodeURIComponent(name)}/papers/${paperId}`,
          { method: 'DELETE' },
        ),

      importBibtex: async (file) => {
        const form = new FormData()
        form.append('file', file)
        return multipartFetch<ImportBibtexResponse>(
          '/api/library/import/bibtex',
          form,
        )
      },
      importRis: async (file, collection) => {
        const form = new FormData()
        form.append('file', file)
        const path =
          '/api/library/import/ris' +
          (collection
            ? `?collection=${encodeURIComponent(collection)}`
            : '')
        return multipartFetch<ImportRisResponse>(path, form)
      },
      exportBibtex: async (opts) => {
        const path =
          '/api/library/export/bibtex' +
          buildQuery((opts ?? {}) as Record<string, unknown>)
        const res = await rawFetch(path)
        return res.text()
      },

      readPaper: (id) =>
        jsonFetch<PaperReadResponse>(`/api/library/paper/${id}/read`),
      askPaper: (id, req) =>
        jsonFetch<AskPaperResponse>(`/api/library/paper/${id}/ask`, {
          method: 'POST',
          body: JSON.stringify(req),
        }),
      askMulti: (req) =>
        jsonFetch<AskMultiResponse>('/api/library/ask-multi', {
          method: 'POST',
          body: JSON.stringify(req),
        }),

      listAnnotations: (paperId) =>
        jsonFetch<PaperAnnotationsResponse>(
          `/api/library/paper/${paperId}/annotations`,
        ),
      addAnnotation: (paperId, req) =>
        jsonFetch<AddAnnotationResponse>(
          `/api/library/paper/${paperId}/annotations`,
          { method: 'POST', body: JSON.stringify(req) },
        ),
      updateAnnotation: (annId, req) =>
        jsonFetch<UpdateAnnotationResponse>(
          `/api/library/annotations/${annId}`,
          { method: 'PUT', body: JSON.stringify(req) },
        ),
      deleteAnnotation: (annId) =>
        jsonFetch<DeleteAnnotationResponse>(
          `/api/library/annotations/${annId}`,
          { method: 'DELETE' },
        ),

      scan: (req) =>
        jsonFetch<ScanDirectoryResponse>('/api/library/scan', {
          method: 'POST',
          body: JSON.stringify(req),
        }),

      pdfUrl: async (paperId) => {
        // `rawFetch` attaches the bearer token — the pre-async variant
        // used a plain URL which silently failed auth against the real
        // lattice-cli middleware. Pulling bytes and wrapping in a blob
        // URL keeps the contract identical to the local facade so
        // PaperArtifactCard doesn't need a per-mode branch.
        try {
          const res = await rawFetch(`/api/library/paper/${paperId}/pdf`)
          const blob = await res.blob()
          return URL.createObjectURL(blob)
        } catch {
          return null
        }
      },

      ready,
    }
  }, [jsonFetch, rawFetch, multipartFetch, ready])
}
