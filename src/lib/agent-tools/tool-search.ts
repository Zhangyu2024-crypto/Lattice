import { LOCAL_TOOL_CATALOG } from './index'
import type { LocalTool, ToolInputSchema } from '../../types/agent-tool'

interface ToolSearchInput {
  query: string
  maxResults?: number
}

interface ToolSearchHit {
  name: string
  description: string
  inputSchema: ToolInputSchema
  score: number
}

interface ToolSearchOutput {
  query: string
  results: Array<Omit<ToolSearchHit, 'score'>>
}

const DEFAULT_MAX_RESULTS = 5

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((tok) => tok.length > 0)
}

function scoreTool(tool: LocalTool, terms: string[]): number {
  if (terms.length === 0) return 0
  const name = tool.name.toLowerCase()
  const desc = tool.description.toLowerCase()
  let score = 0
  for (const term of terms) {
    if (name === term) score += 10
    else if (name.includes(term)) score += 5
    if (desc.includes(term)) score += 1
  }
  return score
}

/**
 * Metadata-only catalog search. Returns the top-N tools whose name /
 * description match the query — does NOT invoke them. Useful when the
 * default tool list is filtered (e.g. plan mode) and the agent wants to
 * discover what's available before exiting.
 */
export const toolSearchTool: LocalTool<ToolSearchInput, ToolSearchOutput> = {
  name: 'tool_search',
  description:
    'Search the local tool catalog by keyword. Returns matching tool metadata (name, description, inputSchema) without invoking anything. Use to discover tools before calling them.',
  trustLevel: 'safe',
  planModeAllowed: true,
  cardMode: 'silent',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Free-text query — keywords from tool name / description.',
      },
      maxResults: {
        type: 'number',
        description: `Maximum hits to return (default ${DEFAULT_MAX_RESULTS}).`,
      },
    },
    required: ['query'],
  },
  async execute(input) {
    if (!input?.query) throw new Error('query is required')
    const limit =
      typeof input.maxResults === 'number' && input.maxResults > 0
        ? Math.floor(input.maxResults)
        : DEFAULT_MAX_RESULTS
    const terms = tokenize(input.query)
    const hits: ToolSearchHit[] = LOCAL_TOOL_CATALOG.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      score: scoreTool(tool, terms),
    }))
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)

    return {
      query: input.query,
      results: hits.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      })),
    }
  },
}
