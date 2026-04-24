import type { PromptCommand } from '../types'
import { buildInlineResearchScaffold } from '../../research-prompts'

// Delegates to the same scaffold builder that `@research <topic>` uses, so
// the transition is a behaviour-preserving refactor. `@research` stays
// wired with a deprecation warning for one release — see
// `AgentComposer.handleSend`.
export const researchCommand: PromptCommand = {
  type: 'prompt',
  name: 'research',
  description: 'Kick off a research agent flow for the given topic',
  argumentHint: '<topic>',
  source: 'builtin',
  paletteGroup: 'Research',
  maxIterations: 12,
  getPrompt: async (args) => buildInlineResearchScaffold(args),
}
