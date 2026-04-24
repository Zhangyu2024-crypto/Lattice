import type { LocalTool } from '../../types/agent-tool'
import { callWorker } from '../worker-client'

interface Input {
  url: string
  max_chars?: number
  timeout?: number
  raw?: boolean
}

interface Output {
  url: string
  status: number
  title: string
  body: string
  contentType: string
  truncated: boolean
  length: number
  summary: string
}

interface WorkerResult {
  success: true
  data: {
    url: string
    status: number
    title: string
    content_type: string
    body: string
    truncated: boolean
    length: number
  }
  summary: string
}

export const webFetchTool: LocalTool<Input, Output> = {
  name: 'web_fetch',
  description:
    'Fetch a URL and return its content as plain text. HTML pages are automatically '
    + 'stripped to readable text (scripts, styles, nav removed). Useful for fetching '
    + 'paper abstracts, database entries, documentation pages, or API responses. '
    + 'Set raw=true to get the original HTML.',
  cardMode: 'info',
  trustLevel: 'sandboxed',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to fetch (https:// prefix optional).' },
      max_chars: { type: 'number', description: 'Max characters to return. Default 50000.' },
      timeout: { type: 'number', description: 'Timeout in seconds. Default 15.' },
      raw: { type: 'boolean', description: 'Return raw HTML instead of stripped text. Default false.' },
    },
    required: ['url'],
  },
  async execute(input) {
    if (!input?.url) throw new Error('url is required')
    const result = await callWorker<WorkerResult>(
      'web.fetch',
      {
        url: input.url,
        max_chars: input.max_chars,
        timeout: input.timeout,
        raw: input.raw,
      },
      { timeoutMs: 30_000 },
    )
    if (!result.ok) throw new Error(result.error)
    const d = result.value.data
    return {
      url: d.url,
      status: d.status,
      title: d.title,
      body: d.body,
      contentType: d.content_type,
      truncated: d.truncated,
      length: d.length,
      summary: result.value.summary,
    }
  },
}
