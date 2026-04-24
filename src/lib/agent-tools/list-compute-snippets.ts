import type { LocalTool } from '../../types/agent-tool'
import type { ComputeLanguage } from '../../types/pro-api'
import { getComputeSnippets } from '../compute-snippets-catalog'

interface Input {
  language?: ComputeLanguage
  category?: string
}

interface SnippetInfo {
  id: string
  title: string
  description: string
  language: string
  category: string
}

interface Output {
  snippets: SnippetInfo[]
  summary: string
}

export const listComputeSnippetsTool: LocalTool<Input, Output> = {
  name: 'list_compute_snippets',
  description:
    'List available compute snippet templates. Filter by language (python/lammps/cp2k) or category (Structure, Simulation, Diffraction, Analysis, Signal, DFT, MD). Use compute_from_snippet to create an artifact from a snippet.',
  trustLevel: 'safe',
  cardMode: 'silent',
  inputSchema: {
    type: 'object',
    properties: {
      language: {
        type: 'string',
        description: 'Filter: "python", "lammps", "cp2k". Omit for all.',
      },
      category: {
        type: 'string',
        description: 'Filter by category name. Omit for all.',
      },
    },
  },

  async execute(input) {
    const lang = input?.language as ComputeLanguage | undefined
    let all = getComputeSnippets(lang)
    if (input?.category) {
      const cat = input.category.toLowerCase()
      all = all.filter((s) => (s.category ?? '').toLowerCase() === cat)
    }
    const snippets: SnippetInfo[] = all
      .filter((s): s is typeof s & { id: string } => typeof s.id === 'string')
      .map((s) => ({
        id: s.id,
        title: s.title ?? s.id,
        description: s.description ?? '',
        language: s.language,
        category: s.category ?? 'General',
      }))
    return {
      snippets,
      summary: `${snippets.length} snippet(s)${lang ? ` [${lang}]` : ''}`,
    }
  },
}
