import type { LocalTool } from '../../types/agent-tool'
import { localProKnowledge } from '../local-pro-knowledge'

interface Input {
  text: string
  paper_id?: number
  title?: string
}

interface Output {
  success: boolean
  chain_count: number
  extraction_id?: number
  error?: string
}

export const knowledgeExtractTool: LocalTool<Input, Output> = {
  name: 'knowledge_extract',
  description:
    'Extract structured knowledge chains (System → Process → State → Measurement) from scientific text using LLM. The extracted chains are stored in the local knowledge database for later search and comparison.',
  cardMode: 'info',
  inputSchema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description:
          'The scientific text to extract knowledge chains from. Can be a paper section, abstract, or any text containing material science data.',
      },
      paper_id: {
        type: 'number',
        description: 'Optional paper ID to link the extraction to a library paper.',
      },
      title: {
        type: 'string',
        description: 'Optional title for the extraction record.',
      },
    },
    required: ['text'],
  },
  async execute(input) {
    if (!input.text || input.text.trim().length < 50) {
      return { success: false, chain_count: 0, error: 'Text too short for extraction (min 50 chars).' }
    }

    const res = await localProKnowledge.extractSelection({
      text: input.text,
      paper_id: input.paper_id,
    })

    if (!res.success) {
      return { success: false, chain_count: 0, error: (res as { error?: string }).error ?? 'Extraction failed.' }
    }

    const successRes = res as { success: true; chains: unknown[]; total: number }
    return {
      success: true,
      chain_count: successRes.total,
    }
  },
}
