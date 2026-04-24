import { localProLibrary } from '../local-pro-library'
import type { LocalTool } from '../../types/agent-tool'

interface Input {
  paperId: number
  question: string
}

interface SourceSummary {
  section?: string
  page?: number
  preview?: string
  score?: number
}

interface Output {
  paperId: number
  answer: string
  sources: SourceSummary[]
}

export const paperRagAskTool: LocalTool<Input, Output> = {
  name: 'paper_rag_ask',
  description:
    'Ask a natural-language question about a single paper in the local Library. Extracts the PDF, retrieves relevant chunks, and synthesises an answer with citations. Requires the paper to have a PDF path (imported via "Scan directory" or manual attach).',
  // Retrieval — silent by default; inspect via the audit chip if needed.
  cardMode: 'silent',
  inputSchema: {
    type: 'object',
    properties: {
      paperId: { type: 'number', description: 'Library paper id.' },
      question: { type: 'string', description: 'User question in natural language.' },
    },
    required: ['paperId', 'question'],
  },
  async execute(input) {
    if (typeof input?.paperId !== 'number') {
      throw new Error('paperId (number) is required')
    }
    if (!input?.question?.trim()) throw new Error('question is required')
    const res = await localProLibrary.askPaper(input.paperId, {
      question: input.question,
    })
    if (!res.success) throw new Error(res.error)
    const sources: SourceSummary[] = (res.sources ?? []).slice(0, 8).map((s) => {
      const rec = s as Record<string, unknown>
      const section = typeof rec.section === 'string' ? rec.section : undefined
      const page = typeof rec.page === 'number' ? rec.page : undefined
      const preview =
        typeof rec.preview === 'string'
          ? rec.preview
          : typeof rec.text === 'string'
            ? String(rec.text).slice(0, 240)
            : undefined
      const score = typeof rec.score === 'number' ? rec.score : undefined
      return { section, page, preview, score }
    })
    return { paperId: input.paperId, answer: res.answer, sources }
  },
}
