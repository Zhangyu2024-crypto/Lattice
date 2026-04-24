// Ghost-text inline completion for the LaTeX editor. When the user pauses
// typing (300ms debounce), sends the text around the cursor to the LLM and
// shows the response as faded "ghost text" that can be accepted with Tab.
//
// Uses CodeMirror 6's `autocompletion` extension with a custom
// `CompletionSource`. The ghost text appears as a single inline completion
// item whose `detail` is empty (so only the `label` renders as the ghost).
//
// Gated by `ghostSuggest` toggle in the LaTeX payload — the extension is
// only injected when the toggle is on.

import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import type { Extension } from '@codemirror/state'

let pendingAbort: AbortController | null = null

async function ghostSource(
  ctx: CompletionContext,
): Promise<CompletionResult | null> {
  // Only trigger on explicit typing (not on programmatic changes).
  if (!ctx.explicit && !ctx.matchBefore(/\S+/)) return null

  // Need at least 10 chars of context before the cursor.
  const pos = ctx.pos
  const docText = ctx.state.doc.toString()
  if (pos < 10) return null

  // Abort any in-flight request.
  pendingAbort?.abort()
  const controller = new AbortController()
  pendingAbort = controller

  // Grab context: current line + 400 chars before.
  const lineStart = ctx.state.doc.lineAt(pos).from
  const contextStart = Math.max(0, pos - 400)
  const before = docText.slice(contextStart, pos)
  const after = docText.slice(pos, Math.min(docText.length, pos + 200))

  try {
    const { sendLlmChat } = await import('../llm-chat')
    const prompt = [
      'SYSTEM: You are an inline LaTeX autocomplete engine. The user is writing a scientific paper.',
      'Given the text before the cursor, predict the next 1-3 sentences they are likely to write.',
      'Output ONLY the continuation text — no preamble, no code fences, no explanation.',
      'If you cannot confidently predict, output nothing.',
      '',
      'TEXT BEFORE CURSOR:',
      before,
      '',
      'TEXT AFTER CURSOR (for context):',
      after,
    ].join('\n')

    const result = await sendLlmChat({
      mode: 'dialog',
      userMessage: prompt,
      transcript: [],
      sessionId: null,
    })

    if (controller.signal.aborted) return null
    if (!result.success || !result.content.trim()) return null

    // Strip any accidental code fences.
    let completion = result.content.trim()
    const fence = completion.match(/^```(?:latex|tex)?\s*\n([\s\S]*?)\n```$/i)
    if (fence) completion = fence[1]
    completion = completion.replace(/^(Here (?:is|are) [^\n:]{1,80}:?\s*)/i, '')
    completion = completion.trim()
    if (!completion) return null

    return {
      from: pos,
      options: [
        {
          label: completion,
          type: 'text',
          boost: 99,
          apply: completion,
        },
      ],
    }
  } catch {
    return null
  }
}

export function ghostCompletionExtension(): Extension {
  return autocompletion({
    override: [ghostSource],
    activateOnTyping: true,
    defaultKeymap: true,
  })
}
