// Phase A2 — `latex_edit_selection` agent tool.
//
// Rewrites, continues, fixes, or polishes a span of a LaTeX artifact. The
// tool returns the `before` / `after` pair (plus the artifact id and span
// offsets) so the edit can be reviewed in a unified tool-card diff and
// applied via `applyLatexEditSelectionPatch` either by the orchestrator
// (agent chat path) or by the floating selection toolbar in
// `LatexDocumentCard` (direct-UI path).
//
// The tool is the single authoritative home for the four verb prompts —
// `src/lib/latex/ai-actions.ts` delegates here so the behaviour stays
// consistent between the chat-initiated and toolbar-initiated paths.
//
// Approval/card semantics:
//  - `cardMode: 'edit'` so the unified AgentCard renders a before/after
//    diff + editable `after` textarea when invoked from the agent loop.
//  - The orchestrator's approval gate only fires on that path. The
//    floating toolbar short-circuits the gate (see
//    `runLatexSelectionAction` + `localStorage['lattice:latex-always-review']`).

import { sendLlmChat } from '../llm-chat'
import { useRuntimeStore } from '../../stores/runtime-store'
import {
  isLatexDocumentArtifact,
  type Artifact,
  type LatexDocumentArtifact,
} from '../../types/artifact'
import type { LocalTool } from '../../types/agent-tool'

export type SelectionVerb = 'rewrite' | 'continue' | 'fix' | 'polish'

const VERB_SET: ReadonlySet<SelectionVerb> = new Set([
  'rewrite',
  'continue',
  'fix',
  'polish',
])

export interface LatexEditSelectionInput {
  artifactId: string
  file: string
  from: number
  to: number
  verb: SelectionVerb
  instruction?: string
}

export interface LatexEditSelectionOutput {
  artifactId: string
  file: string
  from: number
  to: number
  verb: SelectionVerb
  before: string
  after: string
  summary: string
}

// Context window budget around the selection. 600/400 is plenty for the
// model to stay in register without blowing the prompt. Kept in sync with
// the toolbar's contextBefore / contextAfter slices.
const CONTEXT_BEFORE_CHARS = 600
const CONTEXT_AFTER_CHARS = 400

// Deliberately terse. Each system prompt ends with an explicit "output
// only <thing>" clause so the LLM doesn't wrap the span in prose / fences.
// We still post-process with `stripResponseBoilerplate` because responses
// slip into ```latex fences or "Here is…" preambles despite the
// instruction.
const VERB_SYSTEMS: Record<SelectionVerb, string> = {
  rewrite:
    'You rewrite academic LaTeX passages to be clearer and more concise. Preserve every LaTeX command, citation, math environment, and label. Return ONLY the rewritten LaTeX — no prose, no code fences.',
  continue:
    'You continue the user\'s academic LaTeX writing at the marked cursor. Match their tone, terminology, and the paper\'s outline. Output ONLY the continuation text (1–3 sentences unless the context plainly calls for more) — no preamble, no code fences.',
  fix:
    'You fix LaTeX syntax and grammatical errors in the selected passage. Preserve semantics, math, and citations. Return ONLY the corrected LaTeX — no prose, no code fences.',
  polish:
    'You polish the selected academic English while preserving every LaTeX command, citation (\\cite{...}), \\ref, and math-mode content. Do NOT change meaning. Return ONLY the polished LaTeX — no prose, no code fences.',
}

function stripResponseBoilerplate(text: string): string {
  let out = text.trim()
  const fence = out.match(/^```(?:latex|tex)?\s*\n([\s\S]*?)\n```$/i)
  if (fence) out = fence[1]
  out = out.replace(/^(Here (?:is|are) the [^\n:]{1,80}:?\s*)/i, '')
  return out.trim()
}

export interface BuildPromptArgs {
  verb: SelectionVerb
  selection: string
  contextBefore: string
  contextAfter: string
  outline?: string
  instruction?: string
}

export function buildSelectionPrompt(args: BuildPromptArgs): string {
  // sendLlmChat's `messages[]` type forbids a 'system' role (see
  // LlmMessagePayload). We prepend the verb-specific instruction as a
  // SYSTEM-style preamble inside the user message — it sits above the
  // document-level agent system prompt but the model treats the specific
  // instructions near the content as authoritative.
  const parts: string[] = [`SYSTEM: ${VERB_SYSTEMS[args.verb]}`, '']
  if (args.instruction && args.instruction.trim()) {
    parts.push('ADDITIONAL INSTRUCTION:')
    parts.push(args.instruction.trim())
    parts.push('')
  }
  if (args.outline && args.outline.trim()) {
    parts.push('DOCUMENT OUTLINE:')
    parts.push(args.outline.trim())
    parts.push('')
  }
  if (args.contextBefore) {
    parts.push('BEFORE SELECTION:')
    parts.push(args.contextBefore)
    parts.push('')
  }
  if (args.verb === 'continue') {
    parts.push(
      'Continue at the cursor. The selection (if any) is the text just before the cursor.',
    )
    parts.push('TEXT BEFORE CURSOR:')
    parts.push(args.selection)
  } else {
    parts.push('SELECTION:')
    parts.push(args.selection)
  }
  if (args.contextAfter) {
    parts.push('')
    parts.push('AFTER SELECTION:')
    parts.push(args.contextAfter)
  }
  return parts.join('\n')
}

function findLatexArtifact(
  sessionId: string,
  artifactId: string,
): LatexDocumentArtifact {
  const session = useRuntimeStore.getState().sessions[sessionId]
  if (!session) throw new Error(`Session not found: ${sessionId}`)
  const raw: Artifact | undefined = session.artifacts[artifactId]
  if (!raw) throw new Error(`Artifact not found: ${artifactId}`)
  if (!isLatexDocumentArtifact(raw)) {
    throw new Error(
      `Artifact ${artifactId} is kind="${raw.kind}"; expected latex-document.`,
    )
  }
  return raw
}

function outlineToText(artifact: LatexDocumentArtifact): string {
  return artifact.payload.outline
    .map((o) => `${'#'.repeat(o.level)} ${o.title}  (${o.file})`)
    .join('\n')
    .slice(0, 512)
}

function clampSpan(
  length: number,
  from: number,
  to: number,
): { from: number; to: number } {
  const lo = Math.max(0, Math.min(length, Math.floor(from)))
  const hi = Math.max(lo, Math.min(length, Math.floor(to)))
  return { from: lo, to: hi }
}

interface CoreRunArgs {
  artifact: LatexDocumentArtifact
  file: string
  from: number
  to: number
  verb: SelectionVerb
  instruction?: string
  sessionId: string
}

/** Internal core: resolves the span, calls the LLM, returns the
 *  before/after pair. Shared by the LocalTool.execute() path (agent chat)
 *  and the direct toolbar path (auto-approve). */
async function runCore(args: CoreRunArgs): Promise<LatexEditSelectionOutput> {
  const file = args.artifact.payload.files.find((f) => f.path === args.file)
  if (!file) {
    throw new Error(
      `File "${args.file}" not found in artifact ${args.artifact.id}`,
    )
  }
  const { from, to } = clampSpan(file.content.length, args.from, args.to)
  const before = file.content.slice(from, to)
  const contextBefore = file.content.slice(
    Math.max(0, from - CONTEXT_BEFORE_CHARS),
    from,
  )
  const contextAfter = file.content.slice(
    to,
    Math.min(file.content.length, to + CONTEXT_AFTER_CHARS),
  )

  const prompt = buildSelectionPrompt({
    verb: args.verb,
    selection: before,
    contextBefore,
    contextAfter,
    outline: outlineToText(args.artifact),
    instruction: args.instruction,
  })

  const result = await sendLlmChat({
    mode: 'agent',
    userMessage: prompt,
    transcript: [],
    sessionId: args.sessionId,
  })
  if (!result.success) {
    throw new Error(result.error ?? 'LLM call failed')
  }
  const after = stripResponseBoilerplate(result.content)
  const delta = after.length - before.length
  const deltaLabel = delta === 0 ? '±0' : delta > 0 ? `+${delta}` : `${delta}`
  return {
    artifactId: args.artifact.id,
    file: args.file,
    from,
    to,
    verb: args.verb,
    before,
    after,
    summary: `${args.verb} · ${args.file}:${from}-${to} · ${deltaLabel} chars`,
  }
}

export const latexEditSelectionTool: LocalTool<
  LatexEditSelectionInput,
  LatexEditSelectionOutput
> = {
  name: 'latex_edit_selection',
  description:
    'Rewrite, continue, fix, or polish a selected span inside a LaTeX document artifact. Returns before/after text for review; approval applies the patch. Use when the user has a selection in a LaTeX card or asks the agent to edit a specific span.',
  trustLevel: 'localWrite',
  cardMode: 'edit',
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: {
        type: 'string',
        description: 'LaTeX document artifact id.',
      },
      file: {
        type: 'string',
        description: 'Path of the file inside the artifact (e.g. "main.tex").',
      },
      from: {
        type: 'number',
        description: 'Character offset of the selection start (inclusive).',
      },
      to: {
        type: 'number',
        description: 'Character offset of the selection end (exclusive).',
      },
      verb: {
        type: 'string',
        description: 'One of: rewrite | continue | fix | polish.',
      },
      instruction: {
        type: 'string',
        description:
          'Optional extra instruction to layer on top of the verb prompt.',
      },
    },
    required: ['artifactId', 'file', 'from', 'to', 'verb'],
  },
  async execute(input, ctx) {
    if (!input?.artifactId) throw new Error('artifactId is required')
    if (!input.file) throw new Error('file is required')
    if (typeof input.from !== 'number' || typeof input.to !== 'number') {
      throw new Error('from / to must be numbers')
    }
    if (!VERB_SET.has(input.verb)) {
      throw new Error(
        `verb must be one of rewrite|continue|fix|polish (got "${input.verb}")`,
      )
    }
    const artifact = findLatexArtifact(ctx.sessionId, input.artifactId)
    return runCore({
      artifact,
      file: input.file,
      from: input.from,
      to: input.to,
      verb: input.verb,
      instruction: input.instruction,
      sessionId: ctx.sessionId,
    })
  },
}

// ─── Direct (non-agent) entry point for the floating toolbar ─────────────
//
// The `LatexSelectionMenu` dispatches through this helper so its behaviour
// matches the agent-loop path exactly — same prompt, same post-processing,
// same return shape. The toolbar then either applies the patch directly
// (auto-approve default) or pushes a card into the transcript for the
// user to review, gated by the `lattice:latex-always-review` localStorage
// flag.

export interface RunLatexSelectionArgs {
  sessionId: string
  artifactId: string
  file: string
  from: number
  to: number
  verb: SelectionVerb
  instruction?: string
}

export async function runLatexSelectionAction(
  args: RunLatexSelectionArgs,
): Promise<LatexEditSelectionOutput> {
  if (!VERB_SET.has(args.verb)) {
    throw new Error(
      `verb must be one of rewrite|continue|fix|polish (got "${args.verb}")`,
    )
  }
  const artifact = findLatexArtifact(args.sessionId, args.artifactId)
  return runCore({
    artifact,
    file: args.file,
    from: args.from,
    to: args.to,
    verb: args.verb,
    instruction: args.instruction,
    sessionId: args.sessionId,
  })
}

// ─── Patch applier ─────────────────────────────────────────────────────
//
// Apply the output's `after` (or an edited replacement) to the underlying
// artifact through the session store. Used by both the orchestrator-
// approved path (tool card "Approve" button) and the toolbar's direct
// path. Kept here rather than in the orchestrator so the same code runs
// in both entry points.

/**
 * Write the `{ from, to, after }` patch from a tool output back onto the
 * LaTeX artifact. Returns the new content (already persisted). Throws if
 * the artifact / file is missing or the span is out of bounds.
 */
export function applyLatexEditSelectionPatch(
  sessionId: string,
  output: LatexEditSelectionOutput,
): string {
  const store = useRuntimeStore.getState()
  const session = store.sessions[sessionId]
  if (!session) throw new Error(`Session not found: ${sessionId}`)
  const artifact = session.artifacts[output.artifactId]
  if (!artifact) throw new Error(`Artifact not found: ${output.artifactId}`)
  if (!isLatexDocumentArtifact(artifact)) {
    throw new Error(
      `Artifact ${output.artifactId} is kind="${artifact.kind}"; expected latex-document.`,
    )
  }
  const files = artifact.payload.files
  const idx = files.findIndex((f) => f.path === output.file)
  if (idx < 0) {
    throw new Error(
      `File "${output.file}" not found in artifact ${output.artifactId}`,
    )
  }
  const target = files[idx]
  const { from, to } = clampSpan(target.content.length, output.from, output.to)
  const next =
    target.content.slice(0, from) + output.after + target.content.slice(to)
  const nextFiles = files.map((f, i) =>
    i === idx ? { ...f, content: next } : f,
  )
  store.patchArtifact(sessionId, artifact.id, {
    payload: { ...artifact.payload, files: nextFiles },
  } as never)
  return next
}

// Re-export the localStorage flag name so the selection menu + any future
// settings UI agree on the key spelling.
export const LATEX_ALWAYS_REVIEW_KEY = 'lattice:latex-always-review'
