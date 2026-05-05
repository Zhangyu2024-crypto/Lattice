import { sendLlmChat } from '../llm-chat'

// Phase B: 4 selection commands for the LaTeX editor. Each one fires a single
// agent-mode LLM turn (no transcript context — the command carries its own
// prompt) and returns replacement text for the selection.
//
// The prompts are deliberately terse. We're asking for a direct
// transformation of the selected span with as little chance of wrapping in
// backticks or prose as possible. Each system prompt ends with an explicit
// "output only <thing>" clause; we also post-process the response to strip
// common fences/preamble noise.

export type SelectionVerb =
  | 'rewrite'
  | 'continue'
  | 'fix'
  | 'polish'
  | 'translate-en'
  | 'translate-zh'
  | 'expand'
  | 'shorten'
  | 'formalize'

export interface SelectionRequest {
  verb: SelectionVerb
  selection: string
  contextBefore: string
  contextAfter: string
  /** Plain-text outline joined by newlines. Kept short (<512 chars). */
  outline?: string
  sessionId?: string | null
}

export interface SelectionResult {
  ok: boolean
  content: string
  error?: string
}

const SYSTEMS: Record<SelectionVerb, string> = {
  rewrite:
    'You rewrite academic LaTeX passages to be clearer and more concise. Preserve every LaTeX command, citation, math environment, and label. Return ONLY the rewritten LaTeX — no prose, no code fences.',
  continue:
    'You continue the user\'s academic LaTeX writing at the marked cursor. Match their tone, terminology, and the paper\'s outline. Output ONLY the continuation text (1–3 sentences unless the context plainly calls for more) — no preamble, no code fences.',
  fix:
    'You fix LaTeX syntax and grammatical errors in the selected passage. Preserve semantics, math, and citations. Return ONLY the corrected LaTeX — no prose, no code fences.',
  polish:
    'You polish the selected academic English while preserving every LaTeX command, citation (\\cite{...}), \\ref, and math-mode content. Do NOT change meaning. Return ONLY the polished LaTeX — no prose, no code fences.',
  'translate-en':
    'Translate the selected LaTeX passage to English. Preserve ALL LaTeX commands, citations (\\cite{...}), math environments, \\ref, \\label, and formatting. Return ONLY the translated LaTeX — no prose, no code fences.',
  'translate-zh':
    'Translate the selected LaTeX passage to Chinese (Simplified). Preserve ALL LaTeX commands, citations (\\cite{...}), math environments, \\ref, \\label, and formatting. Return ONLY the translated LaTeX — no prose, no code fences.',
  expand:
    'Expand the selected LaTeX passage into a fuller, more detailed paragraph. Add supporting explanation, examples, or transitions while preserving the original meaning, all LaTeX commands, citations, and math. Return ONLY the expanded LaTeX — no prose, no code fences.',
  shorten:
    'Condense the selected LaTeX passage to roughly half its length while preserving the core meaning, all LaTeX commands, citations, and math environments. Return ONLY the shortened LaTeX — no prose, no code fences.',
  formalize:
    'Rewrite the selected passage in a more formal, academic tone suitable for a peer-reviewed journal. Preserve every LaTeX command, citation, math environment, and label. Return ONLY the formalized LaTeX — no prose, no code fences.',
}

function buildUserMessage(req: SelectionRequest): string {
  // sendLlmChat's `messages[]` type forbids a 'system' role (see
  // LlmMessagePayload in src/types/electron.d.ts:41). We prepend the
  // command-specific instruction as a SYSTEM-style preamble inside the user
  // message — it sits above the document-level agent system prompt but the
  // model treats the specific instructions near the content as authoritative.
  const parts: string[] = [`SYSTEM: ${SYSTEMS[req.verb]}`, '']
  if (req.outline && req.outline.trim()) {
    parts.push('DOCUMENT OUTLINE:')
    parts.push(req.outline.trim())
    parts.push('')
  }
  if (req.contextBefore) {
    parts.push('BEFORE SELECTION:')
    parts.push(req.contextBefore)
    parts.push('')
  }
  if (req.verb === 'continue') {
    parts.push('Continue at the cursor. The selection (if any) is the text just before the cursor.')
    parts.push('TEXT BEFORE CURSOR:')
    parts.push(req.selection)
  } else {
    parts.push('SELECTION:')
    parts.push(req.selection)
  }
  if (req.contextAfter) {
    parts.push('')
    parts.push('AFTER SELECTION:')
    parts.push(req.contextAfter)
  }
  return parts.join('\n')
}

// LLM responses often slip into ```latex fences or add a "Here is the …"
// prefix despite the system instruction. Strip the most common wrappers so
// the splice doesn't corrupt the document. Be conservative — we only touch
// obvious boilerplate, never trim inside the content.
function stripResponseBoilerplate(text: string): string {
  let out = text.trim()
  // ```latex ... ```
  const fence = out.match(/^```(?:latex|tex)?\s*\n([\s\S]*?)\n```$/i)
  if (fence) out = fence[1]
  // "Here is the rewritten..." — only when followed by a colon / newline.
  out = out.replace(/^(Here (?:is|are) the [^\n:]{1,80}:?\s*)/i, '')
  return out.trim()
}

export async function runSelectionAction(
  req: SelectionRequest,
): Promise<SelectionResult> {
  const userMessage = buildUserMessage(req)
  try {
    const result = await sendLlmChat({
      mode: 'agent',
      userMessage,
      transcript: [],
      sessionId: req.sessionId ?? null,
      traceModule: 'latex',
      traceOperation:
        req.verb === 'fix' ? 'latex_fix_compile_error' : 'latex_edit_selection',
    })
    if (!result.success) {
      return { ok: false, content: '', error: result.error ?? 'LLM call failed' }
    }
    return { ok: true, content: stripResponseBoilerplate(result.content) }
  } catch (err) {
    return {
      ok: false,
      content: '',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
