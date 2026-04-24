// Token-budgeted conversation trimming. Groups tool_use + tool_result
// pairs as atomic units (providers reject a tool_use without a matching
// tool_result) and walks newest-to-oldest within `budgetTokens`. Split
// from `llm-chat.ts` — pure code motion.

import type { LlmMessagePayload } from '../../types/electron'
import { cloneMessage, estimateMessageTokens } from './messages'

// A group is an atomic unit for trimming: either a single plain message,
// or an `assistant(tool_use)` + `user(tool_result)` pair that must travel
// together (both Anthropic and OpenAI reject an assistant `tool_use` block
// without a matching `tool_result` in the following user turn).
interface MessageGroup {
  messages: LlmMessagePayload[]
  cost: number
}

function messageHasToolUse(msg: LlmMessagePayload): boolean {
  if (typeof msg.content === 'string') return false
  return msg.content.some((block) => block.type === 'tool_use')
}

function messageHasToolResult(msg: LlmMessagePayload): boolean {
  if (typeof msg.content === 'string') return false
  return msg.content.some((block) => block.type === 'tool_result')
}

/**
 * Partition the message stream into atomic groups. An assistant message
 * containing `tool_use` blocks must be kept together with the immediately-
 * following user message containing the matching `tool_result` blocks;
 * otherwise the provider will 400 on us.
 */
function partitionIntoGroups(
  messages: ReadonlyArray<LlmMessagePayload>,
): MessageGroup[] {
  const groups: MessageGroup[] = []
  for (let i = 0; i < messages.length; i++) {
    const current = messages[i]
    const next = messages[i + 1]
    const pairNext =
      current.role === 'assistant' &&
      messageHasToolUse(current) &&
      next &&
      next.role === 'user' &&
      messageHasToolResult(next)
    if (pairNext) {
      groups.push({
        messages: [current, next],
        cost: estimateMessageTokens(current) + estimateMessageTokens(next),
      })
      i += 1
      continue
    }
    // A dangling tool_use with no follow-up tool_result is a bug upstream,
    // but we still emit it as its own group so the trim walker at least
    // can't make it worse.
    groups.push({
      messages: [current],
      cost: estimateMessageTokens(current),
    })
  }
  return groups
}

/**
 * Walk `messages` from newest to oldest in atomic groups and accumulate
 * groups while the estimated token cost stays under `budgetTokens`.
 * Returns the kept messages in chronological order. Always preserves the
 * most-recent group even when its own size exceeds the budget — leaving
 * the conversation footless is worse than slightly overshooting once.
 */
export function buildMessageHistoryWithinTokenBudget(
  messages: ReadonlyArray<LlmMessagePayload>,
  budgetTokens: number,
): LlmMessagePayload[] {
  if (messages.length === 0) return []
  const groups = partitionIntoGroups(messages)
  const reversedGroups: MessageGroup[] = []
  let used = 0
  for (let i = groups.length - 1; i >= 0; i--) {
    const group = groups[i]
    const isMostRecent = reversedGroups.length === 0
    if (!isMostRecent && used + group.cost > budgetTokens) break
    reversedGroups.push(group)
    used += group.cost
    if (used >= budgetTokens) break
  }
  // Flatten back to chronological message order.
  const kept: LlmMessagePayload[] = []
  for (let i = reversedGroups.length - 1; i >= 0; i--) {
    for (const msg of reversedGroups[i].messages) {
      kept.push(cloneMessage(msg))
    }
  }
  return kept
}
