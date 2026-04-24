// Full conversation compaction.
//
// When the auto-compact threshold trips, this module sends the entire
// conversation (minus tool schemas) to the LLM with the compaction prompt
// and replaces the messages array with a compact summary + the most
// recent user intent. The result feeds back into the orchestrator's
// `messages` variable so the next iteration sees a drastically smaller
// context.
//
// The compaction call reuses `sendLlmChat` in agent mode (no tools) so
// it inherits provider resolution, key management, and usage tracking
// from the existing pipeline.

import { sendLlmChat } from '../llm-chat'
import {
  getCompactionPrompt,
  getCompactionUserMessage,
} from './compaction-prompt'
import { estimateMessagesTokens } from './auto-compact'
import type { LlmMessagePayload } from '../../types/electron'
import { useRuntimeStore } from '../../stores/runtime-store'

export interface CompactionResult {
  /** The raw LLM-generated summary text (analysis stripped, summary
   *  formatted). */
  summary: string
  /** The replacement messages array the orchestrator should use for the
   *  next iteration. Contains the summary as a user message so the model
   *  has full context to continue. */
  contextMessages: LlmMessagePayload[]
  /** Token estimate of the conversation before compaction. */
  preCompactTokenCount: number
  /** Token estimate of the post-compaction messages array. */
  postCompactTokenCount: number
}

/**
 * Compact the conversation by asking the LLM to produce a structured
 * summary, then replace the messages array with the summary.
 *
 * The compaction LLM call is a plain text request (no tool schemas) to
 * keep cost low and avoid the model attempting tool calls during
 * summarisation.
 *
 * @param messages            Current conversation messages.
 * @param sessionId           Active session id (for usage tracking).
 * @param signal              Optional abort signal.
 * @param customInstructions  Optional per-session summarisation hints.
 * @returns                   The compacted messages and token metrics.
 * @throws                    When the LLM call fails.
 */
export async function compactConversation(
  messages: LlmMessagePayload[],
  sessionId: string,
  signal?: AbortSignal,
  customInstructions?: string,
): Promise<CompactionResult> {
  const preCompactTokenCount = estimateMessagesTokens(messages)

  // Build the compaction prompt and append it as a trailing user message
  // so the model sees the full conversation followed by the summarisation
  // instruction.
  const compactionPrompt = getCompactionPrompt(customInstructions)
  const compactionMessages: LlmMessagePayload[] = [
    ...messages,
    { role: 'user', content: compactionPrompt },
  ]

  const result = await sendLlmChat({
    mode: 'agent',
    userMessage: compactionPrompt,
    transcript: [],
    sessionId,
    // Send the full conversation + compaction instruction as pre-built
    // messages so the LLM sees everything. No tools — this is a pure
    // text summarisation call.
    messages: compactionMessages,
    // No tools — compaction is text-only.
    tools: undefined,
  })

  if (!result.success) {
    throw new Error(
      `Context compaction failed: ${result.error ?? 'unknown LLM error'}`,
    )
  }

  const rawSummary = result.content
  if (!rawSummary || rawSummary.trim().length === 0) {
    throw new Error(
      'Context compaction failed: LLM returned an empty summary.',
    )
  }

  // Build the post-compaction messages: a single user message containing
  // the formatted summary with continuation instructions.
  const summaryUserMessage: LlmMessagePayload = {
    role: 'user',
    content: getCompactionUserMessage(rawSummary),
  }

  const contextMessages: LlmMessagePayload[] = [summaryUserMessage]

  // Re-inject plan content so it survives compaction. Without this the
  // model loses its working plan after the summary replaces the full
  // message history.
  const session = useRuntimeStore.getState().sessions[sessionId]
  const planText = session?.planMode?.plan
  if (planText) {
    const planLabel = session?.planMode?.active
      ? '[Active plan — you are currently in plan mode]\n'
      : '[Plan from before compaction]\n'
    contextMessages.push({
      role: 'user',
      content: `${planLabel}${planText}`,
    })
  }

  const postCompactTokenCount = estimateMessagesTokens(contextMessages)

  return {
    summary: rawSummary,
    contextMessages,
    preCompactTokenCount,
    postCompactTokenCount,
  }
}
