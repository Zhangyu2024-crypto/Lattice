import type { LocalTool } from '../../types/agent-tool'
import { callWorker } from '../worker-client'

interface Input {
  query: string
  max_results?: number
  timeout?: number
}

interface SearchResult {
  title: string
  url: string
  snippet: string
}

interface Output {
  query: string
  answer: string
  results: SearchResult[]
  count: number
  summary: string
}

interface WorkerResult {
  success: true
  data: {
    query: string
    answer?: string
    results: SearchResult[]
    count: number
  }
  summary: string
}

export const webSearchTool: LocalTool<Input, Output> = {
  name: 'web_search',
  description:
    'Search the web via Tavily Search API and return results with title, URL, snippet, '
    + 'and an AI-generated answer. Requires TAVILY_API_KEY env var. '
    + 'Use this for general web queries — finding documentation, looking up materials properties, '
    + 'searching for papers or datasets. For academic literature specifically, prefer '
    + 'literature_search (OpenAlex + arXiv) which returns richer metadata.',
  cardMode: 'info',
  trustLevel: 'sandboxed',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query string.' },
      max_results: { type: 'number', description: 'Max results to return. Default 5.' },
      timeout: { type: 'number', description: 'Timeout in seconds. Default 30.' },
    },
    required: ['query'],
  },
  async execute(input) {
    if (!input?.query) throw new Error('query is required')
    const result = await callWorker<WorkerResult>(
      'web.search',
      {
        query: input.query,
        max_results: input.max_results,
        timeout: input.timeout,
      },
      { timeoutMs: 45_000 },
    )
    if (!result.ok) throw new Error(result.error)
    return {
      query: result.value.data.query,
      answer: result.value.data.answer ?? '',
      results: result.value.data.results,
      count: result.value.data.count,
      summary: result.value.summary,
    }
  },
}
