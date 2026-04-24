// Auto-compaction trigger logic.
//
// Provides a pure predicate that the agent orchestrator checks before each
// LLM call to decide whether the conversation has grown large enough to
// warrant a full compaction pass. The threshold is expressed as a
// percentage of the context window — the same approach Claude Code uses.

import { estimateMessageTokens } from '../llm-chat/messages'
import type { LlmMessagePayload } from '../../types/electron'

/** Default context window size (tokens) used when the model's actual
 *  window is unknown. 200k matches Anthropic's Claude 3.5/4 family. */
export const DEFAULT_CONTEXT_WINDOW = 200_000

/** Fraction of the context window at which auto-compaction fires. 80%
 *  leaves enough room for one more tool-use round trip before the
 *  history-budget trimmer would start discarding messages. */
export const AUTO_COMPACT_THRESHOLD = 0.80

/**
 * Estimate the total token cost of a messages array.
 */
export function estimateMessagesTokens(
  messages: ReadonlyArray<LlmMessagePayload>,
): number {
  let total = 0
  for (const msg of messages) {
    total += estimateMessageTokens(msg)
  }
  return total
}

export interface ContextUsage {
  /** Raw estimated token count across all messages. */
  estimatedTokens: number
  /** Fraction of the context window consumed (0..1+). */
  percentage: number
}

/**
 * Compute how much of the context window the current conversation
 * occupies. Useful for UI indicators and for the auto-compact predicate.
 */
export function getContextUsage(
  messages: ReadonlyArray<LlmMessagePayload>,
  contextWindowSize: number = DEFAULT_CONTEXT_WINDOW,
): ContextUsage {
  const estimatedTokens = estimateMessagesTokens(messages)
  const window = Math.max(1, contextWindowSize)
  return {
    estimatedTokens,
    percentage: estimatedTokens / window,
  }
}

/**
 * Should the orchestrator run a compaction pass before the next LLM call?
 *
 * Returns `true` when the estimated token count exceeds
 * {@link AUTO_COMPACT_THRESHOLD} of the context window. The check is
 * intentionally cheap (heuristic token estimation, no tokenizer) because
 * it runs on every iteration.
 */
export function shouldAutoCompact(
  messages: ReadonlyArray<LlmMessagePayload>,
  contextWindowSize: number = DEFAULT_CONTEXT_WINDOW,
): boolean {
  // No point compacting a near-empty conversation — the summary would be
  // larger than the original. Require at least 4 messages (two round trips)
  // before considering compaction.
  if (messages.length < 4) return false

  const { percentage } = getContextUsage(messages, contextWindowSize)
  return percentage >= AUTO_COMPACT_THRESHOLD
}
