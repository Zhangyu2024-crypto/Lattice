// Typed client for `/api/knowledge/*` endpoints.

import { useMemo } from 'react'
import { useBackendFetch, type BackendFetchErrors } from './useBackendFetch'
import type {
  AddKnowledgeTagRequest,
  AddKnowledgeTagResponse,
  CompareMaterialsRequest,
  CompareMaterialsResponse,
  ExtractionTimelineResponse,
  ExtractSelectionRequest,
  ExtractSelectionResponse,
  HeatmapResponse,
  KnowledgeExtractionDetail,
  KnowledgeExtractionRow,
  KnowledgeExtractionsQuery,
  KnowledgeExtractionsResponse,
  KnowledgePaperGroupRow,
  KnowledgeProjectsResponse,
  KnowledgeSearchQuery,
  KnowledgeSearchResponse,
  KnowledgeStats,
  KnowledgeTagsResponse,
  MetricDistributionResponse,
  PeaksByTechniqueResponse,
  RemoveKnowledgeTagResponse,
  SaveChainsRequest,
  SaveChainsResponse,
  VariableListResponse,
} from '../types/knowledge-api'

export class KnowledgeApiError extends Error {
  readonly status: number
  readonly body: string
  constructor(message: string, status: number, body: string) {
    super(message)
    this.name = 'KnowledgeApiError'
    this.status = status
    this.body = body
  }
}

export class KnowledgeBackendNotReadyError extends Error {
  constructor() {
    super('Backend not connected — Knowledge API unavailable')
    this.name = 'KnowledgeBackendNotReadyError'
  }
}

export interface KnowledgeApi {
  stats: () => Promise<KnowledgeStats>
  listExtractions: (
    q?: KnowledgeExtractionsQuery,
  ) => Promise<KnowledgeExtractionsResponse>
  getExtraction: (id: number) => Promise<KnowledgeExtractionDetail>
  search: (q: KnowledgeSearchQuery) => Promise<KnowledgeSearchResponse>
  /** Returns a CSV string ready for client-side download. */
  exportCsv: () => Promise<string>
  compareMaterials: (
    req: CompareMaterialsRequest,
  ) => Promise<CompareMaterialsResponse>
  deleteExtraction: (id: number) => Promise<{ success: boolean }>

  listTags: () => Promise<KnowledgeTagsResponse>
  addTag: (
    extractionId: number,
    req: AddKnowledgeTagRequest,
  ) => Promise<AddKnowledgeTagResponse>
  removeTag: (
    extractionId: number,
    tag: string,
  ) => Promise<RemoveKnowledgeTagResponse>

  listProjects: () => Promise<KnowledgeProjectsResponse>

  extractSelection: (
    req: ExtractSelectionRequest,
  ) => Promise<ExtractSelectionResponse>
  saveChains: (req: SaveChainsRequest) => Promise<SaveChainsResponse>

  metricDistribution: (
    metric: string,
    limit?: number,
  ) => Promise<MetricDistributionResponse>
  heatmap: (opts?: {
    max_materials?: number
    max_metrics?: number
  }) => Promise<HeatmapResponse>
  timeline: () => Promise<ExtractionTimelineResponse>
  peaks: (
    technique: string,
    limit?: number,
  ) => Promise<PeaksByTechniqueResponse>
  variableList: () => Promise<VariableListResponse>
  papers: (limit?: number) => Promise<KnowledgePaperGroupRow[]>

  readonly ready: boolean
}

// Shared across all `useKnowledgeApi` instances so `useBackendFetch`'s
// memoised callbacks stay referentially stable.
const KNOWLEDGE_FETCH_ERRORS: BackendFetchErrors = {
  notReady: () => new KnowledgeBackendNotReadyError(),
  http: (message, status, body) => new KnowledgeApiError(message, status, body),
}

export function useKnowledgeApi(): KnowledgeApi {
  const { jsonFetch, rawFetch, ready } = useBackendFetch(KNOWLEDGE_FETCH_ERRORS)

  return useMemo<KnowledgeApi>(() => {
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
      stats: () => jsonFetch<KnowledgeStats>('/api/knowledge/stats'),
      listExtractions: (q) =>
        jsonFetch<KnowledgeExtractionsResponse>(
          `/api/knowledge/extractions${buildQuery(q as Record<string, unknown>)}`,
        ),
      getExtraction: (id) =>
        jsonFetch<KnowledgeExtractionDetail>(
          `/api/knowledge/extraction/${id}`,
        ),
      search: (q) =>
        jsonFetch<KnowledgeSearchResponse>(
          `/api/knowledge/search${buildQuery(q as Record<string, unknown>)}`,
        ),
      exportCsv: async () => {
        const res = await rawFetch('/api/knowledge/export/csv')
        return res.text()
      },
      compareMaterials: (req) =>
        jsonFetch<CompareMaterialsResponse>('/api/knowledge/compare', {
          method: 'POST',
          body: JSON.stringify(req),
        }),
      deleteExtraction: (id) =>
        jsonFetch<{ success: boolean }>(`/api/knowledge/extraction/${id}`, {
          method: 'DELETE',
        }),

      listTags: () => jsonFetch<KnowledgeTagsResponse>('/api/knowledge/tags'),
      addTag: (extractionId, req) =>
        jsonFetch<AddKnowledgeTagResponse>(
          `/api/knowledge/extraction/${extractionId}/tags`,
          { method: 'POST', body: JSON.stringify(req) },
        ),
      removeTag: (extractionId, tag) =>
        jsonFetch<RemoveKnowledgeTagResponse>(
          `/api/knowledge/extraction/${extractionId}/tags/${encodeURIComponent(tag)}`,
          { method: 'DELETE' },
        ),

      listProjects: () =>
        jsonFetch<KnowledgeProjectsResponse>('/api/knowledge/projects'),

      extractSelection: (req) =>
        jsonFetch<ExtractSelectionResponse>(
          '/api/knowledge/extract-selection',
          { method: 'POST', body: JSON.stringify(req) },
        ),
      saveChains: (req) =>
        jsonFetch<SaveChainsResponse>('/api/knowledge/save-chains', {
          method: 'POST',
          body: JSON.stringify(req),
        }),

      metricDistribution: (metric, limit = 20) =>
        jsonFetch<MetricDistributionResponse>(
          `/api/knowledge/metric-distribution?metric=${encodeURIComponent(
            metric,
          )}&limit=${limit}`,
        ),
      heatmap: (opts) =>
        jsonFetch<HeatmapResponse>(
          `/api/knowledge/heatmap${buildQuery(opts as Record<string, unknown>)}`,
        ),
      timeline: () =>
        jsonFetch<ExtractionTimelineResponse>('/api/knowledge/timeline'),
      peaks: (technique, limit = 30) =>
        jsonFetch<PeaksByTechniqueResponse>(
          `/api/knowledge/peaks?technique=${encodeURIComponent(
            technique,
          )}&limit=${limit}`,
        ),
      variableList: () =>
        jsonFetch<VariableListResponse>('/api/knowledge/variable-list'),
      papers: (limit = 50) =>
        jsonFetch<KnowledgePaperGroupRow[]>(
          `/api/knowledge/papers?limit=${limit}`,
        ),

      ready,
    }
  }, [jsonFetch, rawFetch, ready])
}

// Silence unused-import warning on extraction row type used only for
// narrowing in consumer components.
type _keepTypes = KnowledgeExtractionRow
void (0 as unknown as _keepTypes)
