import { localProLibrary } from '../local-pro-library'
import type { LocalTool } from '../../types/agent-tool'

interface Input {
  q?: string
  tag?: string
  year?: string
  collection?: string
  limit?: number
  sort?: 'updated_at' | 'year' | 'title' | 'authors' | 'id'
  order?: 'asc' | 'desc'
}

interface PaperSummary {
  id: number
  title: string
  authors: string
  year: string
  journal?: string
  doi?: string
  tags?: string[]
  hasPdf: boolean
}

interface Output {
  total: number
  returned: number
  papers: PaperSummary[]
}

export const listPapersTool: LocalTool<Input, Output> = {
  name: 'list_papers',
  description:
    'List papers in the local Library. Supports full-text query, tag/year/collection filters, sort + order. Returns trimmed paper metadata (id, title, authors, journal, hasPdf). Use paper_rag_ask on a specific id for content.',
  // Retrieval tool — silent by default (surfaces through the audit chip).
  cardMode: 'silent',
  inputSchema: {
    type: 'object',
    properties: {
      q: { type: 'string', description: 'Free-text query over title/abstract.' },
      tag: { type: 'string' },
      year: { type: 'string' },
      collection: { type: 'string' },
      limit: { type: 'number', description: 'Max papers to return. Default 25.' },
      sort: { type: 'string', description: 'updated_at | year | title | authors | id' },
      order: { type: 'string', description: 'asc | desc' },
    },
  },
  async execute(input) {
    const limit = Math.max(1, Math.min(input?.limit ?? 25, 100))
    const res = await localProLibrary.listPapers({
      q: input?.q,
      tag: input?.tag,
      year: input?.year,
      collection: input?.collection,
      limit,
      sort: input?.sort,
      order: input?.order,
    })
    const papers: PaperSummary[] = res.papers.map((p) => ({
      id: p.id,
      title: p.title,
      authors: p.authors,
      year: p.year,
      journal: p.journal,
      doi: p.doi,
      tags: p.tags,
      hasPdf: Boolean(p.pdf_path),
    }))
    return { total: res.total, returned: papers.length, papers }
  },
}
