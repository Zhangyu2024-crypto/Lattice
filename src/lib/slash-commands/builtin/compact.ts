import type { LocalCommand, LocalCommandResult } from '../types'
import type { TranscriptMessage } from '../../../types/session'
import { useRuntimeStore } from '../../../stores/runtime-store'
import { sendLlmChat } from '../../llm-chat'

// User-triggered conversation compaction. Mirrors Claude Code's `/compact`
// with Lattice's constraints:
//
//   - Transcripts persist only plain-text user/assistant/system turns,
//     never tool_use/tool_result blocks. So we summarise the transcript
//     itself, not an internal message array.
//   - dialog mode was removed (see agent-submit.ts:126); we issue the
//     summary request in agent mode with an empty tools array, which
//     behaves as a one-shot LLM call.
//   - The summary message is injected as `role: 'system'` so it renders
//     with the existing system-message styling the transcript renderer
//     already uses for slash-command text output.
//
// Too-short transcripts no-op with a diagnostic message — summarising
// three messages into a bullet list is worse UX than not touching it.

const MIN_SUBSTANTIAL_MESSAGES = 4
const KEEP_RECENT_PAIRS = 1

const SUMMARY_PROMPT =
  'Summarise the conversation so far. Preserve: key decisions, ' +
  'artifacts created or referenced, unresolved questions, and the current ' +
  'task the user is working on. Format as terse bullet points — no ' +
  'preamble, no headers, no closing remarks. One bullet per distinct fact.'

export const compactCommand: LocalCommand = {
  type: 'local',
  name: 'compact',
  description: 'Summarise and compact the conversation to free up context',
  source: 'builtin',
  paletteGroup: 'Conversation',
  call: async (_args, ctx) => {
    if (!ctx.sessionId) return { kind: 'skip' }

    const substantial = ctx.transcript.filter(
      (m) => m.role === 'user' || m.role === 'assistant',
    )
    if (substantial.length < MIN_SUBSTANTIAL_MESSAGES) {
      return textResult(
        `Conversation has only ${substantial.length} substantive message(s); nothing to compact yet.`,
      )
    }

    const keepTail = pickRecentTail(ctx.transcript, KEEP_RECENT_PAIRS)

    const result = await sendLlmChat({
      mode: 'agent',
      userMessage: SUMMARY_PROMPT,
      transcript: ctx.transcript,
      sessionId: ctx.sessionId,
      tools: [],
    })

    if (!result.success) {
      return textResult(
        `Compact failed: ${result.error ?? 'unknown error'}. Transcript unchanged.`,
      )
    }

    const summary = result.content.trim()
    if (!summary) {
      return textResult(
        'Compact aborted: model returned an empty summary. Transcript unchanged.',
      )
    }

    const store = useRuntimeStore.getState()
    const now = Date.now()

    store.clearTranscript(ctx.sessionId)
    store.appendTranscript(ctx.sessionId, {
      id: `compact_${now}`,
      role: 'system',
      content: `Conversation compacted. Summary:\n\n${summary}`,
      timestamp: now,
    })
    // Re-append the preserved tail with suffixed ids so React keys stay
    // unique against any other session mutation that might race this.
    for (const msg of keepTail) {
      store.appendTranscript(ctx.sessionId, { ...msg, id: `${msg.id}_kept` })
    }

    return { kind: 'skip' }
  },
}

function textResult(text: string): LocalCommandResult {
  return { kind: 'text', text }
}

// Walk backwards and pick the last `n` full user→assistant pairs. Messages
// with role 'system' interleave freely and are not counted. Returns the
// pairs in original forward order so re-appending preserves the flow.
export function pickRecentTail(
  transcript: readonly TranscriptMessage[],
  n: number,
): TranscriptMessage[] {
  if (n <= 0) return []
  const out: TranscriptMessage[] = []
  let pairsFound = 0
  let pendingAssistantIdx: number | null = null
  for (let i = transcript.length - 1; i >= 0; i--) {
    const msg = transcript[i]
    if (msg.role === 'assistant' && pendingAssistantIdx === null) {
      pendingAssistantIdx = i
      continue
    }
    if (msg.role === 'user' && pendingAssistantIdx !== null) {
      out.unshift(msg, transcript[pendingAssistantIdx])
      pendingAssistantIdx = null
      pairsFound++
      if (pairsFound >= n) break
    }
  }
  return out
}
