// Typed client for `/api/pro/*` endpoints on the lattice-cli backend.
//
// Mirrors the convention of `useApi.ts` — the hook reads `backend` state from
// `app-store`, attaches the bearer token, and returns a memoised bundle of
// endpoint methods. Using a dedicated hook keeps the ~20 pro-mode methods from
// cluttering `useApi` and makes it obvious from call sites whether a component
// is hitting pro endpoints.
//
// Design notes
// - All methods reject (not resolve) on non-2xx so callers can use try/catch.
// - Request/response types live in `../types/pro-api.ts`.
// - `uploadCif` is the only multipart endpoint; it takes a File directly.

import { useCallback, useMemo } from 'react'
import { useAppStore } from '../stores/app-store'
import type {
  AssessQualityResponse,
  BaselineRequest,
  BaselineResponse,
  ChargeCorrectRequest,
  ChargeCorrectResponse,
  ClearPeaksResponse,
  ComputeExecRequest,
  ComputeExecResponse,
  ComputeHealthResponse,
  ComputeLanguage,
  ComputeSnippetsResponse,
  DeleteCifResponse,
  DetectPeaksRequest,
  DetectPeaksResponse,
  ExportRefinedCifResponse,
  ExportReportRequest,
  ExportReportResponse,
  ListCifsResponse,
  ListScriptsResponse,
  LoadScriptResponse,
  PredictXrdRequest,
  PredictXrdResponse,
  RamanIdentifyRequest,
  RamanIdentifyResponse,
  SaveScriptRequest,
  SaveScriptResponse,
  SmoothRequest,
  SmoothResponse,
  UndoResponse,
  UploadCifResponse,
  XpsFitRequest,
  XpsFitResponse,
  XpsLookupRequest,
  XpsLookupResponse,
  XpsQuantifyRequest,
  XpsQuantifyResponse,
  XrdRefineRequest,
  XrdRefineResponse,
  XrdSearchRequest,
  XrdSearchResponse,
} from '../types/pro-api'

export class ProApiError extends Error {
  readonly status: number
  readonly body: string
  constructor(message: string, status: number, body: string) {
    super(message)
    this.name = 'ProApiError'
    this.status = status
    this.body = body
  }
}

export class ProBackendNotReadyError extends Error {
  constructor() {
    super('Backend not connected — Pro API unavailable')
    this.name = 'ProBackendNotReadyError'
  }
}

export interface ProApi {
  // Core processing
  detectPeaks: (req?: DetectPeaksRequest) => Promise<DetectPeaksResponse>
  smooth: (req?: SmoothRequest) => Promise<SmoothResponse>
  baseline: (req?: BaselineRequest) => Promise<BaselineResponse>
  undo: () => Promise<UndoResponse>
  clearPeaks: () => Promise<ClearPeaksResponse>
  assessQuality: () => Promise<AssessQualityResponse>

  // XRD
  xrdSearch: (req: XrdSearchRequest) => Promise<XrdSearchResponse>
  xrdRefine: (req: XrdRefineRequest) => Promise<XrdRefineResponse>
  uploadCif: (file: File) => Promise<UploadCifResponse>
  listCifs: () => Promise<ListCifsResponse>
  deleteCif: (id: string) => Promise<DeleteCifResponse>
  predictXrd: (req: PredictXrdRequest) => Promise<PredictXrdResponse>
  exportRefinedCif: () => Promise<ExportRefinedCifResponse>

  // XPS
  chargeCorrect: (req: ChargeCorrectRequest) => Promise<ChargeCorrectResponse>
  xpsFit: (req: XpsFitRequest) => Promise<XpsFitResponse>
  xpsQuantify: (req: XpsQuantifyRequest) => Promise<XpsQuantifyResponse>
  xpsLookup: (req: XpsLookupRequest) => Promise<XpsLookupResponse>

  // Raman / FTIR
  ramanIdentify: (req: RamanIdentifyRequest) => Promise<RamanIdentifyResponse>

  // Compute workbench
  computeExec: (req: ComputeExecRequest) => Promise<ComputeExecResponse>
  computeHealth: () => Promise<ComputeHealthResponse>
  computeSnippets: (language?: ComputeLanguage) => Promise<ComputeSnippetsResponse>
  computeSaveScript: (req: SaveScriptRequest) => Promise<SaveScriptResponse>
  computeListScripts: () => Promise<ListScriptsResponse>
  computeLoadScript: (name: string) => Promise<LoadScriptResponse>

  // Reports
  exportReport: (req: ExportReportRequest) => Promise<ExportReportResponse>

  // State
  readonly ready: boolean
}

export function useProApi(): ProApi {
  const backend = useAppStore((s) => s.backend)

  const jsonFetch = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      if (!backend.ready) throw new ProBackendNotReadyError()
      const res = await fetch(`${backend.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${backend.token}`,
          'Content-Type': 'application/json',
          ...(init?.headers ?? {}),
        },
      })
      if (!res.ok) {
        const body = await safeText(res)
        throw new ProApiError(
          `HTTP ${res.status} ${res.statusText}`,
          res.status,
          body,
        )
      }
      return (await res.json()) as T
    },
    [backend.ready, backend.baseUrl, backend.token],
  )

  const multipartFetch = useCallback(
    async <T,>(path: string, form: FormData): Promise<T> => {
      if (!backend.ready) throw new ProBackendNotReadyError()
      const res = await fetch(`${backend.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${backend.token}`,
          // Do NOT set Content-Type — the browser adds a multipart boundary.
        },
        body: form,
      })
      if (!res.ok) {
        const body = await safeText(res)
        throw new ProApiError(
          `HTTP ${res.status} ${res.statusText}`,
          res.status,
          body,
        )
      }
      return (await res.json()) as T
    },
    [backend.ready, backend.baseUrl, backend.token],
  )

  return useMemo<ProApi>(() => {
    const postJson = <TReq, TRes>(path: string) =>
      async (body: TReq): Promise<TRes> =>
        jsonFetch<TRes>(path, {
          method: 'POST',
          body: JSON.stringify(body ?? {}),
        })
    const post = <TRes>(path: string) =>
      async (): Promise<TRes> =>
        jsonFetch<TRes>(path, { method: 'POST', body: '{}' })
    const getJson = <TRes>(path: string) =>
      async (): Promise<TRes> => jsonFetch<TRes>(path, { method: 'GET' })

    return {
      detectPeaks: async (req = {}) =>
        jsonFetch<DetectPeaksResponse>('/api/pro/detect-peaks', {
          method: 'POST',
          body: JSON.stringify(req),
        }),
      smooth: async (req = {}) =>
        jsonFetch<SmoothResponse>('/api/pro/smooth', {
          method: 'POST',
          body: JSON.stringify(req),
        }),
      baseline: async (req = {}) =>
        jsonFetch<BaselineResponse>('/api/pro/baseline', {
          method: 'POST',
          body: JSON.stringify(req),
        }),
      undo: post<UndoResponse>('/api/pro/undo'),
      clearPeaks: post<ClearPeaksResponse>('/api/pro/clear-peaks'),
      assessQuality: post<AssessQualityResponse>('/api/pro/assess-quality'),

      xrdSearch: postJson<XrdSearchRequest, XrdSearchResponse>('/api/pro/xrd-search'),
      xrdRefine: postJson<XrdRefineRequest, XrdRefineResponse>('/api/pro/xrd-refine'),
      uploadCif: async (file: File) => {
        const form = new FormData()
        form.append('file', file)
        return multipartFetch<UploadCifResponse>('/api/pro/upload-cif', form)
      },
      listCifs: getJson<ListCifsResponse>('/api/pro/list-cifs'),
      deleteCif: async (id: string) =>
        jsonFetch<DeleteCifResponse>('/api/pro/delete-cif', {
          method: 'POST',
          body: JSON.stringify({ id }),
        }),
      predictXrd: postJson<PredictXrdRequest, PredictXrdResponse>('/api/pro/predict-xrd'),
      exportRefinedCif: post<ExportRefinedCifResponse>('/api/pro/export-refined-cif'),

      chargeCorrect: postJson<ChargeCorrectRequest, ChargeCorrectResponse>(
        '/api/pro/charge-correct',
      ),
      xpsFit: postJson<XpsFitRequest, XpsFitResponse>('/api/pro/xps-fit'),
      xpsQuantify: postJson<XpsQuantifyRequest, XpsQuantifyResponse>(
        '/api/pro/xps-quantify',
      ),
      xpsLookup: postJson<XpsLookupRequest, XpsLookupResponse>('/api/pro/xps-lookup'),

      ramanIdentify: postJson<RamanIdentifyRequest, RamanIdentifyResponse>(
        '/api/pro/raman-identify',
      ),

      computeExec: postJson<ComputeExecRequest, ComputeExecResponse>(
        '/api/pro/compute/exec',
      ),
      computeHealth: getJson<ComputeHealthResponse>('/api/pro/compute/health'),
      computeSnippets: async (language) => {
        const path = language
          ? `/api/pro/compute/snippets?language=${encodeURIComponent(language)}`
          : '/api/pro/compute/snippets'
        return jsonFetch<ComputeSnippetsResponse>(path, { method: 'GET' })
      },
      computeSaveScript: postJson<SaveScriptRequest, SaveScriptResponse>(
        '/api/pro/compute/save-script',
      ),
      computeListScripts: getJson<ListScriptsResponse>('/api/pro/compute/scripts'),
      computeLoadScript: async (name) =>
        jsonFetch<LoadScriptResponse>(
          `/api/pro/compute/script/${encodeURIComponent(name)}`,
          { method: 'GET' },
        ),

      exportReport: postJson<ExportReportRequest, ExportReportResponse>(
        '/api/pro/export-report',
      ),

      ready: backend.ready,
    }
  }, [jsonFetch, multipartFetch, backend.ready])
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}
