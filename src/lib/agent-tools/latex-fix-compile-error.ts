import type { LocalTool } from '../../types/agent-tool'
import type { LatexCompileError, LatexDocumentPayload } from '../../types/latex'
import { useRuntimeStore } from '../../stores/runtime-store'
import { sendLlmChat } from '../llm-chat'

interface Input {
  artifactId?: string
  errorIndex?: number
}

interface SuccessOutput {
  success: true
  artifactId: string
  file: string
  fromLine: number
  toLine: number
  replacement: string
  errorMessage: string
  summary: string
}

interface ErrorOutput {
  success: false
  error: string
}

type Output = SuccessOutput | ErrorOutput

const EXCERPT_CONTEXT_LINES = 5
const PREAMBLE_LINES = 50

const SYSTEM_PROMPT =
  'Fix the reported pdfLaTeX compile error. Return ONLY the corrected ' +
  'replacement for the shown excerpt (same line range). No prose, no ' +
  'code fences.'

function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:[a-zA-Z]+)?\n([\s\S]*?)\n```$/)
  if (fenced) return fenced[1]
  return trimmed
}

export const latexFixCompileErrorTool: LocalTool<Input, Output> = {
  name: 'latex_fix_compile_error',
  description:
    'Fix a pdfLaTeX compile error in a latex-document artifact. Picks the ' +
    'first error (or `errorIndex`) from the artifact payload, ships a ±5 ' +
    'line excerpt + the preamble to the LLM, and returns the corrected ' +
    'replacement for human approval. The edit is applied on Approve by the ' +
    'card, not by this tool.',
  trustLevel: 'localWrite',
  cardMode: 'edit',
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: {
        type: 'string',
        description: 'latex-document artifact id.',
      },
      errorIndex: {
        type: 'number',
        description:
          'Index into `payload.errors`. Defaults to 0 (the first error).',
      },
    },
    required: ['artifactId'],
  },

  async execute(input, ctx) {
    const artifactId =
      typeof input?.artifactId === 'string' ? input.artifactId.trim() : ''
    if (!artifactId) {
      return { success: false, error: 'artifactId is required (string)' }
    }

    const session = useRuntimeStore.getState().sessions[ctx.sessionId]
    if (!session) {
      return { success: false, error: `Session not found: ${ctx.sessionId}` }
    }
    const artifact = session.artifacts[artifactId]
    if (!artifact || artifact.kind !== 'latex-document') {
      return {
        success: false,
        error: `latex-document artifact not found: ${artifactId}`,
      }
    }

    const payload = artifact.payload as LatexDocumentPayload
    const errors: LatexCompileError[] = payload.errors ?? []
    if (errors.length === 0) {
      return {
        success: false,
        error: 'No compile errors on this artifact to fix.',
      }
    }
    const idx =
      typeof input.errorIndex === 'number' &&
      Number.isInteger(input.errorIndex) &&
      input.errorIndex >= 0 &&
      input.errorIndex < errors.length
        ? input.errorIndex
        : 0
    const err = errors[idx]
    const errorLine = typeof err.line === 'number' ? err.line : null

    // Prefer the error's own file; fall back to rootFile when unresolved
    // (pdftex routinely loses file attribution on deep nested includes).
    const targetFile =
      (err.file && payload.files.find((f) => f.path === err.file)) ||
      payload.files.find((f) => f.path === payload.rootFile) ||
      payload.files[0]

    if (!targetFile) {
      return {
        success: false,
        error: 'Artifact has no files to patch.',
      }
    }

    const sourceLines = targetFile.content.split('\n')
    const centre = errorLine != null ? errorLine - 1 : 0
    const fromIndex = Math.max(0, centre - EXCERPT_CONTEXT_LINES)
    const toIndex = Math.min(sourceLines.length - 1, centre + EXCERPT_CONTEXT_LINES)
    const excerpt = sourceLines.slice(fromIndex, toIndex + 1).join('\n')

    const rootFile =
      payload.files.find((f) => f.path === payload.rootFile) ?? payload.files[0]
    const preamble = rootFile
      ? rootFile.content.split('\n').slice(0, PREAMBLE_LINES).join('\n')
      : ''

    const userPrompt =
      `${SYSTEM_PROMPT}\n\n` +
      `ERROR: ${err.message}\n` +
      `LINE: ${errorLine ?? '(unknown)'}\n` +
      `EXCERPT:\n${excerpt}\n` +
      `PREAMBLE:\n${preamble}`

    const llm = await sendLlmChat({
      mode: 'agent',
      userMessage: userPrompt,
      transcript: [],
      sessionId: ctx.sessionId,
    })
    if (!llm.success) {
      return {
        success: false,
        error: llm.error ?? 'LLM call failed',
      }
    }
    const replacement = stripCodeFence(llm.content)
    if (!replacement) {
      return { success: false, error: 'LLM returned an empty replacement.' }
    }

    return {
      success: true,
      artifactId,
      file: targetFile.path,
      fromLine: fromIndex + 1,
      toLine: toIndex + 1,
      replacement,
      errorMessage: err.message,
      summary: `Proposed fix for ${targetFile.path}:${errorLine ?? '?'} — ${err.message.slice(0, 80)}`,
    }
  },
}

// ─── Patch applier ─────────────────────────────────────────────────────
//
// Replace lines `[fromLine, toLine]` (1-indexed, inclusive) in the target
// file with `replacement`. Called from the AgentCard's Approve handler via
// the tool applier-registry — the orchestrator's tool_result echo alone
// doesn't mutate the artifact.

export function applyLatexFixCompileErrorPatch(
  sessionId: string,
  output: SuccessOutput,
): void {
  const store = useRuntimeStore.getState()
  const session = store.sessions[sessionId]
  if (!session) return
  const artifact = session.artifacts[output.artifactId]
  if (!artifact || artifact.kind !== 'latex-document') return
  const payload = artifact.payload as LatexDocumentPayload
  const fileIdx = payload.files.findIndex((f) => f.path === output.file)
  if (fileIdx < 0) return
  const target = payload.files[fileIdx]
  const lines = target.content.split('\n')
  const from = Math.max(1, Math.min(lines.length, output.fromLine)) - 1
  const to = Math.max(from, Math.min(lines.length, output.toLine)) - 1
  const before = lines.slice(0, from)
  const after = lines.slice(to + 1)
  const next = [...before, ...output.replacement.split('\n'), ...after].join('\n')
  const nextFiles = payload.files.map((f, i) =>
    i === fileIdx ? { ...f, content: next } : f,
  )
  store.patchArtifact(sessionId, artifact.id, {
    payload: { ...payload, files: nextFiles },
  } as never)
}
