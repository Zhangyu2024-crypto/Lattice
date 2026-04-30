// `compute_create_script` — generate a Python/pymatgen compute script from
// a natural-language intent and open it as a new `compute` artifact.
//
// Why this exists
//   Asking the agent to author pymatgen / ASE / MP-API snippets by hand
//   bloats the transcript and mixes code with conversation. This tool
//   externalises that work into a reusable artifact that the user can
//   inspect, tweak, and re-run via the existing ComputeArtifactCard (same
//   code path as `Open in Code`).
//
// Shape of the result
//   - Creates a `ComputeArtifact` with `status='idle'`, no stdout/stderr,
//     no figures — identical to what `openInCode` produces. The script
//     body is whatever the LLM returned; nothing else about the artifact
//     is LLM-dependent.
//   - Focuses the new artifact so the editor surface jumps to it.
//   - Does NOT execute the script. Use `compute_run` for that.

import type { ComputeArtifact } from '../../types/artifact'
import type { LocalTool } from '../../types/agent-tool'
import { sendLlmChat } from '../llm-chat'
import { genArtifactId, useRuntimeStore } from '../../stores/runtime-store'

interface Input {
  /** Free-text description of what the script should compute. */
  intent: string
  /** Optional short human-readable title. Falls back to a truncated intent. */
  title?: string
  /** Optional hint listing libraries the script should rely on
   *  (e.g. "pymatgen, numpy"). Not enforced — the LLM treats it as a nudge. */
  libraries?: string
}

interface Output {
  artifactId: string
  summary: string
}

const MAX_TITLE_LEN = 80
const CODE_FENCE_RE = /```(?:python|py)?\s*\n([\s\S]*?)\n```/i

export const computeCreateScriptTool: LocalTool<Input, Output> = {
  name: 'compute_create_script',
  description:
    'Generate a Python compute script from a natural-language intent and open it as a new compute artifact (idle, not yet executed). Use this when the user asks for a calculation, simulation, or data transformation that should live as an editable script instead of inline code in chat. Do not use this to replace built-in spectrum analysis/refinement tools such as xrd_refine. The returned artifactId can be passed to compute_run to execute it.',
  trustLevel: 'localWrite',
  cardMode: 'edit',
  inputSchema: {
    type: 'object',
    properties: {
      intent: {
        type: 'string',
        description:
          "What the script should compute, in plain English. Example: 'Fetch mp-149 from Materials Project and plot its DOS using pymatgen'.",
      },
      title: {
        type: 'string',
        description:
          'Optional short title for the artifact card. Falls back to a truncated intent.',
      },
      libraries: {
        type: 'string',
        description:
          "Optional comma-separated libraries the script should prefer (e.g. 'pymatgen, numpy, matplotlib').",
      },
    },
    required: ['intent'],
  },

  async execute(input, ctx) {
    if (ctx.signal.aborted) throw new Error('Aborted before start')

    const intent = typeof input?.intent === 'string' ? input.intent.trim() : ''
    if (!intent) throw new Error('intent is required')
    const libraries =
      typeof input?.libraries === 'string' && input.libraries.trim().length > 0
        ? input.libraries.trim()
        : null
    const explicitTitle =
      typeof input?.title === 'string' && input.title.trim().length > 0
        ? input.title.trim()
        : null

    const session = useRuntimeStore.getState().sessions[ctx.sessionId]
    if (!session) throw new Error(`Session not found: ${ctx.sessionId}`)

    const prompt = buildPrompt(intent, libraries)
    const llm = await sendLlmChat({
      mode: 'agent',
      userMessage: prompt,
      transcript: [],
      sessionId: ctx.sessionId,
    })
    if (!llm.success) throw new Error(llm.error ?? 'LLM call failed')
    if (ctx.signal.aborted) throw new Error('Aborted after LLM call')

    const code = extractScript(llm.content)
    if (!code) throw new Error('LLM did not return a usable Python script.')

    const title = explicitTitle ?? deriveTitle(intent)

    const now = Date.now()
    const artifact: ComputeArtifact = {
      id: genArtifactId(),
      kind: 'compute',
      title,
      createdAt: now,
      updatedAt: now,
      payload: {
        language: 'python',
        code,
        stdout: '',
        stderr: '',
        figures: [],
        exitCode: null,
        status: 'idle',
      },
    }

    const store = useRuntimeStore.getState()
    store.upsertArtifact(ctx.sessionId, artifact)
    store.focusArtifact(ctx.sessionId, artifact.id)

    // Phase 7c — write the .py body to the workspace so Explorer shows it.
    if (ctx.orchestrator?.fs) {
      try {
        const slug = deriveTitle(intent)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/(^_|_$)/g, '')
          .slice(0, 48) || 'script'
        const relPath = await ctx.orchestrator.emitTextFile(
          `script/${slug}-${artifact.id.slice(-6)}.py`,
          code,
        )
        if (relPath) ctx.orchestrator.openFile(relPath)
      } catch (err) {
        console.warn('[compute_create_script] workspace emit failed', err)
      }
    }

    const lineCount = code.split('\n').length
    return {
      artifactId: artifact.id,
      summary: `Draft compute script "${title}" (${lineCount} lines, status=idle). Run it with compute_run.`,
    }
  },
}

function buildPrompt(intent: string, libraries: string | null): string {
  return [
    'You are authoring a Python script that will run inside the Lattice compute container.',
    'The container already has pymatgen, ASE, numpy, scipy, matplotlib, and pandas installed.',
    libraries ? `Prefer these libraries when applicable: ${libraries}.` : null,
    '',
    'Constraints:',
    '- One self-contained script. No external input files — embed any required constants.',
    '- Print a short human-readable summary to stdout so the user can read the result.',
    '- If you render a figure, use matplotlib with `plt.savefig(...)`; a headless backend is preconfigured.',
    '- Do NOT call `input()`, prompt the user, or open network sockets other than documented APIs (e.g. Materials Project REST).',
    '- Do NOT write code fences that are nested inside the script — only ONE outer fence wrapping the whole script.',
    '',
    `Intent: ${intent}`,
    '',
    'Return ONLY the script wrapped in a single ```python fenced block. No prose outside the fence.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

/** Pull the script out of the LLM reply. Accepts fenced blocks or, as a
 *  last resort, the raw content when it already looks like Python. */
function extractScript(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const fenced = CODE_FENCE_RE.exec(trimmed)
  if (fenced && fenced[1]) return fenced[1].trim()
  // Permissive fallback: if the model ignored the fence directive but still
  // returned plausible Python, accept it rather than refusing the turn.
  if (/^\s*(import |from |def |#|print\()/m.test(trimmed)) return trimmed
  return ''
}

function deriveTitle(intent: string): string {
  const oneLine = intent.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= MAX_TITLE_LEN) return oneLine
  return `${oneLine.slice(0, MAX_TITLE_LEN - 1)}…`
}
