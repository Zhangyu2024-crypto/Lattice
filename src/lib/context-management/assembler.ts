// Context assembler for LLM requests.
//
// This is the first explicit boundary for Lattice's context-management
// system: callers provide the fixed prompt parts (system prompt, mention
// blocks, tool schemas) plus the candidate message history, and receive a
// token-accounted request view with history trimmed to fit.
//
// Keeping this accounting out of `llm-chat.ts` lets future surfaces (a
// `/context` command or UI context inspector) report the same categories
// the request builder actually uses.

import type {
  LlmContextBlockPayload,
  LlmInvokeRequestPayload,
  LlmMessagePayload,
} from '../../types/electron'
import type { ComposerMode } from '../../types/llm'
import { estimateMentionsBudget, estimateTokens } from '../token-estimator'
import {
  estimateMessageTokens,
  serializeToolsForInvoke,
} from '../llm-chat/messages'
import { buildMessageHistoryWithinTokenBudget } from '../llm-chat/history-budget'
import type { ToolDefinitionLike } from '../llm-chat/types'
import { HISTORY_SAFETY_MARGIN } from '../llm-chat/constants'

export interface ContextAssemblyInput {
  mode: ComposerMode
  systemPrompt: string
  contextBlocks: ReadonlyArray<LlmContextBlockPayload>
  sourceMessages: ReadonlyArray<LlmMessagePayload>
  tools?: ReadonlyArray<ToolDefinitionLike>
  requestCeiling: number
  safetyMargin?: number
}

export interface ContextBudgetBreakdown {
  requestCeiling: number
  safetyMargin: number
  systemTokens: number
  contextBlockTokens: number
  toolSchemaTokens: number
  rawHistoryTokens: number
  historyBudget: number
  trimmedHistoryTokens: number
  estimatedInputTokens: number
  sourceMessageCount: number
  trimmedMessageCount: number
}

export interface ContextAssemblyResult {
  messages: LlmMessagePayload[]
  toolsForInvoke?: NonNullable<LlmInvokeRequestPayload['tools']>
  budget: ContextBudgetBreakdown
}

export function assembleLlmContext(
  input: ContextAssemblyInput,
): ContextAssemblyResult {
  const requestCeiling = Math.max(0, Math.floor(input.requestCeiling))
  const safetyMargin =
    typeof input.safetyMargin === 'number' && Number.isFinite(input.safetyMargin)
      ? Math.max(0, Math.floor(input.safetyMargin))
      : HISTORY_SAFETY_MARGIN

  const toolsForInvoke =
    input.mode === 'agent' && input.tools && input.tools.length > 0
      ? serializeToolsForInvoke(input.tools)
      : undefined

  const systemTokens = estimateTokens(input.systemPrompt)
  const contextBlockTokens = estimateMentionsBudget(input.contextBlocks)
  const toolSchemaTokens = estimateToolSchemaTokens(toolsForInvoke)
  const rawHistoryTokens = estimateMessagesTokens(input.sourceMessages)

  const fixedTokens = systemTokens + contextBlockTokens + toolSchemaTokens
  const historyBudget = Math.max(
    0,
    requestCeiling - fixedTokens - safetyMargin,
  )
  const messages = buildMessageHistoryWithinTokenBudget(
    input.sourceMessages,
    historyBudget,
  )
  const trimmedHistoryTokens = estimateMessagesTokens(messages)

  return {
    messages,
    ...(toolsForInvoke ? { toolsForInvoke } : {}),
    budget: {
      requestCeiling,
      safetyMargin,
      systemTokens,
      contextBlockTokens,
      toolSchemaTokens,
      rawHistoryTokens,
      historyBudget,
      trimmedHistoryTokens,
      estimatedInputTokens: fixedTokens + trimmedHistoryTokens,
      sourceMessageCount: input.sourceMessages.length,
      trimmedMessageCount: messages.length,
    },
  }
}

function estimateToolSchemaTokens(
  tools: NonNullable<LlmInvokeRequestPayload['tools']> | undefined,
): number {
  if (!tools || tools.length === 0) return 0
  return estimateTokens(JSON.stringify(tools))
}

function estimateMessagesTokens(
  messages: ReadonlyArray<LlmMessagePayload>,
): number {
  let total = 0
  for (const message of messages) {
    total += estimateMessageTokens(message)
  }
  return total
}
