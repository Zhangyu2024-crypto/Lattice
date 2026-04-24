import type { LocalTool } from '../../types/agent-tool'

interface AskUserQuestionOption {
  id: string
  label: string
  detail?: string
}

interface AskUserQuestionInput {
  title: string
  detail?: string
  options?: AskUserQuestionOption[]
  placeholder?: string
}

interface AskUserQuestionOutput {
  answerId?: string
  answerText?: string
}

/**
 * Pause the agent loop and ask the user a clarifying question. Resolves with
 * the chosen option id (when `options` were provided) and/or free-text reply.
 * Throws when the UI surface is unavailable (e.g. a non-interactive runner)
 * so the orchestrator can fall back to defaults instead of hanging.
 */
export const askUserQuestionTool: LocalTool<
  AskUserQuestionInput,
  AskUserQuestionOutput
> = {
  name: 'ask_user_question',
  description:
    'Ask the user a clarifying question and wait for their reply. Use sparingly — only when you genuinely cannot proceed without input. Provide multiple-choice `options` whenever possible to reduce friction.',
  trustLevel: 'safe',
  planModeAllowed: true,
  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Short question shown to the user as the dialog title.',
      },
      detail: {
        type: 'string',
        description: 'Optional longer explanation rendered below the title.',
      },
      options: {
        type: 'array',
        description:
          'Multiple-choice options. Each item: {id, label, detail?}. Omit for free-text.',
      },
      placeholder: {
        type: 'string',
        description: 'Placeholder text for the free-text reply field.',
      },
    },
    required: ['title'],
  },
  async execute(input, ctx) {
    if (!input?.title) throw new Error('title is required')
    if (!ctx.ui) throw new Error('UI not available for ask_user_question')
    return ctx.ui.askUser({
      title: input.title,
      detail: input.detail,
      options: input.options,
      placeholder: input.placeholder,
    })
  },
}
