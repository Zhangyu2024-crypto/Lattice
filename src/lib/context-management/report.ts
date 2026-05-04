// Context usage reporting.
//
// Mirrors the request-shaping path by delegating to `assembleLlmContext`.
// This gives UI/debug tools a stable, category-level view of what the next
// LLM request would contain without duplicating token accounting.

import type {
  LlmContextBlockPayload,
  LlmMessagePayload,
} from '../../types/electron'
import type { ComposerMode } from '../../types/llm'
import type { ToolDefinitionLike } from '../llm-chat/types'
import { assembleLlmContext } from './assembler'

export interface ContextUsageCategory {
  name: string
  tokens: number
  percentage: number
}

export interface ContextUsageReport {
  mode: ComposerMode
  requestCeiling: number
  estimatedInputTokens: number
  percentUsed: number
  categories: ContextUsageCategory[]
  messageCounts: {
    source: number
    included: number
    dropped: number
  }
  historyBudget: number
}

export function buildContextUsageReport(input: {
  mode: ComposerMode
  systemPrompt: string
  contextBlocks: ReadonlyArray<LlmContextBlockPayload>
  sourceMessages: ReadonlyArray<LlmMessagePayload>
  tools?: ReadonlyArray<ToolDefinitionLike>
  requestCeiling: number
  safetyMargin?: number
}): ContextUsageReport {
  const assembled = assembleLlmContext(input)
  const { budget } = assembled
  const ceiling = Math.max(1, budget.requestCeiling)
  const categories = [
    { name: 'System prompt', tokens: budget.systemTokens },
    { name: 'Mention context', tokens: budget.contextBlockTokens },
    { name: 'Tool schemas', tokens: budget.toolSchemaTokens },
    { name: 'Included history', tokens: budget.trimmedHistoryTokens },
    { name: 'Safety margin', tokens: budget.safetyMargin },
  ].map((category) => ({
    ...category,
    percentage: Math.round((category.tokens / ceiling) * 1000) / 10,
  }))

  return {
    mode: input.mode,
    requestCeiling: budget.requestCeiling,
    estimatedInputTokens: budget.estimatedInputTokens,
    percentUsed: Math.round((budget.estimatedInputTokens / ceiling) * 1000) / 10,
    categories,
    messageCounts: {
      source: budget.sourceMessageCount,
      included: budget.trimmedMessageCount,
      dropped: Math.max(0, budget.sourceMessageCount - budget.trimmedMessageCount),
    },
    historyBudget: budget.historyBudget,
  }
}
