// Message payload helpers: build user turns (incl. vision attachments),
// flatten session transcripts into the IPC shape, clone structured
// payloads, and estimate token cost across text / image / tool-use /
// tool-result blocks. Split from `llm-chat.ts` — pure code motion.

import { estimateTokens } from '../token-estimator'
import type {
  LlmInvokeRequestPayload,
  LlmMessageBlockPayload,
  LlmMessagePayload,
  LlmImageBlockPayload,
} from '../../types/electron'
import type { TranscriptMessage } from '../../types/session'
import type { ToolDefinitionLike } from './types'

/** Build the IPC user message shape for optional vision attachments. */
export function userMessagePayload(
  text: string,
  images?: ReadonlyArray<{ base64: string; mediaType: string }>,
): LlmMessagePayload {
  if (!images || images.length === 0) {
    return { role: 'user', content: text }
  }
  const blocks: LlmMessageBlockPayload[] = []
  const t = text.trim()
  // Providers reject an all-empty user turn; keep a minimal text part.
  blocks.push({ type: 'text', text: t.length > 0 ? t : ' ' })
  for (const img of images) {
    const payload: LlmImageBlockPayload = {
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mediaType,
        data: img.base64,
      },
    }
    blocks.push(payload)
  }
  return { role: 'user', content: blocks }
}

/**
 * Flatten a transcript (as persisted in session-store) into the neutral
 * `LlmMessagePayload[]` shape. System messages are filtered out — the
 * proxy's `system` field carries those separately.
 */
export function transcriptToLlmMessages(
  transcript: ReadonlyArray<TranscriptMessage>,
): LlmMessagePayload[] {
  return transcript
    .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
    .map((msg) => {
      if (msg.role === 'user' && msg.attachedImages?.length) {
        return userMessagePayload(msg.content, msg.attachedImages)
      }
      return {
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      }
    })
}

/** Estimate token cost of a message regardless of whether its content is a
 *  plain string or a structured block array. */
export function estimateMessageTokens(message: LlmMessagePayload): number {
  if (typeof message.content === 'string') {
    return estimateTokens(message.content)
  }
  return message.content.reduce(
    (sum, block) => sum + estimateBlockTokens(block),
    0,
  )
}

export function estimateBlockTokens(block: LlmMessageBlockPayload): number {
  if (block.type === 'text') return estimateTokens(block.text)
  if (block.type === 'image') {
    const bytes = Math.floor((block.source.data.length * 3) / 4)
    return Math.max(768, Math.ceil(bytes / 2048) * 400)
  }
  if (block.type === 'tool_result') return estimateTokens(block.content)
  // tool_use: the model didn't emit any text, but the input args do count.
  return estimateTokens(
    JSON.stringify({ id: block.id, name: block.name, input: block.input }),
  )
}

/** Serialise local tool definitions into the IPC payload shape. Only the
 *  schema surface crosses the boundary; `execute` stays in the renderer. */
export function serializeToolsForInvoke(
  tools: ReadonlyArray<ToolDefinitionLike>,
): NonNullable<LlmInvokeRequestPayload['tools']> {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }))
}

export function cloneMessage(msg: LlmMessagePayload): LlmMessagePayload {
  return typeof msg.content === 'string'
    ? { role: msg.role, content: msg.content }
    : {
        role: msg.role,
        content: msg.content.map((block) =>
          block.type === 'image'
            ? {
                type: 'image' as const,
                source: { ...block.source },
              }
            : { ...block },
        ),
      }
}
