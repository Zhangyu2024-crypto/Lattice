// `compute_edit_script` — rewrite an existing compute artifact's script
// according to a natural-language instruction.
//
// This is the counterpart to `compute_create_script`. The create tool
// authors a script from zero; edit takes a stored script + a change
// request and produces a replacement. We pass the full prior script to the
// LLM so it can preserve unrelated structure instead of re-deriving the
// whole thing from the instruction.
//
// The resulting script is written back with `patchArtifact` so the
// artifact's identity (id, createdAt) is preserved; only `payload.code`
// and `updatedAt` change. The run-state fields (stdout, figures,
// exitCode, status) are explicitly reset to 'idle' so stale output from a
// previous run does not read as if it came from the edited script.

import type { ComputeArtifact } from '../../types/artifact'
import type { LocalTool } from '../../types/agent-tool'
import { isComputeArtifact } from '../../types/artifact'
import { sendLlmChat } from '../llm-chat'
import { useRuntimeStore } from '../../stores/runtime-store'

interface Input {
  artifactId: string
  /** Natural-language description of the change the user wants. */
  instruction: string
}

interface Output {
  artifactId: string
  summary: string
  /** |new.length - old.length|. Cheap signal for the agent that "something
   *  substantive actually happened" vs. a no-op rewrite. */
  diffSize: number
  /** Line count before the edit — paired with `newLines` so the card can
   *  render a before/after without having to reconstruct the old script
   *  (the artifact payload no longer holds it once the edit commits). */
  oldLines?: number
  /** Line count after the edit. */
  newLines?: number
}

const CODE_FENCE_RE = /```(?:python|py)?\s*\n([\s\S]*?)\n```/i

export const computeEditScriptTool: LocalTool<Input, Output> = {
  name: 'compute_edit_script',
  description:
    "Modify an existing compute artifact's Python script according to a natural-language instruction (e.g. 'switch from DFT to MP REST lookup' or 'plot band gap vs. volume instead of DOS'). The artifact keeps its id; only the script body and updatedAt change, and any prior run output is reset. Use this when the user wants to refine a script you already authored.",
  trustLevel: 'localWrite',
  cardMode: 'review',
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: {
        type: 'string',
        description:
          "The compute artifact whose script you want to edit. Must be a 'compute' kind artifact.",
      },
      instruction: {
        type: 'string',
        description:
          "What to change, in plain English. Be specific about intent, not the exact diff — the LLM produces the new script.",
      },
    },
    required: ['artifactId', 'instruction'],
  },

  async execute(input, ctx) {
    if (ctx.signal.aborted) throw new Error('Aborted before start')

    const artifactId =
      typeof input?.artifactId === 'string' ? input.artifactId.trim() : ''
    if (!artifactId) throw new Error('artifactId is required')
    const instruction =
      typeof input?.instruction === 'string' ? input.instruction.trim() : ''
    if (!instruction) throw new Error('instruction is required')

    const session = useRuntimeStore.getState().sessions[ctx.sessionId]
    if (!session) throw new Error(`Session not found: ${ctx.sessionId}`)
    const artifact = session.artifacts[artifactId]
    if (!artifact) throw new Error(`Artifact not found: ${artifactId}`)
    if (!isComputeArtifact(artifact)) {
      throw new Error(
        `Artifact ${artifactId} is kind="${artifact.kind}"; compute_edit_script requires a 'compute' artifact.`,
      )
    }

    const oldCode = artifact.payload.code ?? ''
    if (oldCode.trim().length === 0) {
      throw new Error(
        `Compute artifact ${artifactId} has no script to edit. Create one first with compute_create_script.`,
      )
    }

    const prompt = buildPrompt(oldCode, instruction)
    const llm = await sendLlmChat({
      mode: 'agent',
      userMessage: prompt,
      transcript: [],
      sessionId: ctx.sessionId,
    })
    if (!llm.success) throw new Error(llm.error ?? 'LLM call failed')
    if (ctx.signal.aborted) throw new Error('Aborted after LLM call')

    const newCode = extractScript(llm.content)
    if (!newCode) {
      throw new Error('LLM did not return a usable Python script.')
    }
    if (newCode === oldCode) {
      return {
        artifactId,
        diffSize: 0,
        summary:
          'Edit produced an identical script — the instruction may have already been applied. No changes written.',
      }
    }

    const diffSize = Math.abs(newCode.length - oldCode.length)

    // Preserve identity + creation time; only rewrite the code and clear
    // stale run results so the next run starts from a clean slate.
    const store = useRuntimeStore.getState()
    const nextPayload: ComputeArtifact['payload'] = {
      ...artifact.payload,
      code: newCode,
      stdout: '',
      stderr: '',
      figures: [],
      exitCode: null,
      status: 'idle',
      runId: null,
      durationMs: undefined,
    }
    store.patchArtifact(ctx.sessionId, artifactId, {
      payload: nextPayload,
    })

    // Phase 7c — overwrite the workspace .py file with the edited script.
    if (ctx.orchestrator?.fs) {
      try {
        const slug = (artifact.title ?? 'script')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/(^_|_$)/g, '')
          .slice(0, 48) || 'script'
        await ctx.orchestrator.emitTextFile(
          `script/${slug}-${artifactId.slice(-6)}.py`,
          newCode,
        )
      } catch (err) {
        console.warn('[compute_edit_script] workspace emit failed', err)
      }
    }

    const oldLines = oldCode.split('\n').length
    const newLines = newCode.split('\n').length
    return {
      artifactId,
      diffSize,
      oldLines,
      newLines,
      summary: `Rewrote compute script: ${oldLines} → ${newLines} lines (Δ${diffSize} chars). Run it with compute_run.`,
    }
  },
}

function buildPrompt(oldCode: string, instruction: string): string {
  return [
    'You are editing an existing Python script that runs inside the Lattice compute container.',
    'The container has pymatgen, ASE, numpy, scipy, matplotlib, and pandas installed.',
    '',
    'Current script:',
    '```python',
    oldCode,
    '```',
    '',
    `Requested change: ${instruction}`,
    '',
    'Rules:',
    '- Return the FULL updated script, not a diff or patch.',
    '- Preserve unrelated structure, comments, and imports when the change does not touch them.',
    '- Keep the script self-contained and non-interactive (no input(), no external files).',
    '- If the change conflicts with what the current script does, prefer the new instruction.',
    '',
    'Return ONLY the new script wrapped in a single ```python fenced block. No prose outside the fence.',
  ].join('\n')
}

function extractScript(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const fenced = CODE_FENCE_RE.exec(trimmed)
  if (fenced && fenced[1]) return fenced[1].trim()
  if (/^\s*(import |from |def |#|print\()/m.test(trimmed)) return trimmed
  return ''
}
