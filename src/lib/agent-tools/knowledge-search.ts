import { useAppStore } from '../../stores/app-store'
import type { LocalTool } from '../../types/agent-tool'
import type {
  KnowledgeSearchQuery,
  KnowledgeSearchResponse,
} from '../../types/knowledge-api'
import { localProKnowledge } from '../local-pro-knowledge'

interface Input extends KnowledgeSearchQuery {}

interface Output {
  type: string
  count: number
  data: KnowledgeSearchResponse
}

export const knowledgeSearchTool: LocalTool<Input, Output> = {
  name: 'knowledge_search',
  description:
    'Full-text / metric / material search over knowledge-graph extractions. Returns chain matches grouped by search mode (material / metric / technique / browse). Works with both backend and local knowledge database.',
  cardMode: 'silent',
  inputSchema: {
    type: 'object',
    properties: {
      q: { type: 'string', description: 'Free-text query.' },
      material: { type: 'string', description: 'Restrict to a material/formula.' },
      metric: { type: 'string', description: 'Restrict to a metric name (e.g. "band_gap").' },
      technique: { type: 'string', description: 'Restrict to a technique (xrd/xps/raman/…).' },
      tag: { type: 'string' },
      limit: { type: 'number', description: 'Max results. Default 25.' },
      min_confidence: { type: 'number', description: '0–1 confidence floor.' },
    },
  },
  async execute(input) {
    const backend = useAppStore.getState().backend
    const q = input ?? {}

    if (backend.ready) {
      const params = new URLSearchParams()
      if (q.q) params.set('q', q.q)
      if (q.material) params.set('material', q.material)
      if (q.metric) params.set('metric', q.metric)
      if (q.technique) params.set('technique', q.technique)
      if (q.tag) params.set('tag', q.tag)
      if (q.limit != null) params.set('limit', String(q.limit))
      if (q.min_confidence != null) params.set('min_confidence', String(q.min_confidence))
      const res = await fetch(`${backend.baseUrl}/api/knowledge/search?${params}`, {
        headers: { Authorization: `Bearer ${backend.token}` },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
      const data = (await res.json()) as KnowledgeSearchResponse
      return { type: data.type, count: countResults(data), data }
    }

    const data = await localProKnowledge.search(q)
    return { type: data.type, count: countResults(data), data }
  },
}

function countResults(data: KnowledgeSearchResponse): number {
  const bag = data as { results?: unknown[]; data?: { results?: unknown[] } }
  if (Array.isArray(bag.results)) return bag.results.length
  if (Array.isArray(bag.data?.results)) return bag.data.results.length
  return 0
}
