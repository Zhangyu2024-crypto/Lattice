import type { PromptCommand } from '../types'
import { buildResearchScaffold } from '../../research-prompts'

export const RESEARCH_COMMAND_MAX_ITERATIONS = 80

// Slash-only entry point for the unified research flow.
export const researchCommand: PromptCommand = {
  type: 'prompt',
  name: 'research',
  description: 'Kick off a research agent flow for the given topic',
  argumentHint: '<topic>',
  source: 'builtin',
  paletteGroup: 'Research',
  maxIterations: RESEARCH_COMMAND_MAX_ITERATIONS,
  getPrompt: async (args) => buildResearchScaffold(args),
}
