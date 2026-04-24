// `build_structure` agent tool — natural-language → pymatgen code →
// container exec → parsed structure artifact.
//
// Two call surfaces share the same body:
//   • `buildStructureTool.execute` — invoked by the orchestrator when
//     the chat agent picks the tool. Hits the cardMode:'review' gate so
//     the user can still Reject before the artifact lands.
//   • `buildStructureDirect` — the "Add Structure" modal calls this
//     directly (skipping the agent loop + approval card) because the
//     modal itself is already the user's explicit confirmation.
//
// The pipeline is intentionally lightweight: no cell is created, no
// pymatgen source is persisted on the artifact. The generated code
// exists only as a momentary bridge between LLM reply and Structure
// artifact; users who want a reproducible script can ask the agent for
// one separately or use the legacy structure-ai cells.

import { createStructureFromCif } from '../structure-builder'
import { invokeLlmForStructureCode } from '../llm-client'
import { localProCompute, slugForCifKey } from '../local-pro-compute'
import type { LocalTool, ToolExecutionContext } from '../../types/agent-tool'

export interface BuildStructureInput {
  description: string
  title?: string
}

export interface BuildStructureSuccess {
  success: true
  artifactId: string
  formula: string
  spaceGroup: string
  cellVolume: number
  /** Key the compute runner will inject this structure under in
   *  `ACTIVE_CIFS`. Pass it to `load_structure('<key>')` inside a
   *  LAMMPS / CP2K / Python cell to grab the pymatgen Structure.
   *  Matches the slug produced by `buildRunContext` in
   *  `src/lib/local-pro-compute.ts`. */
  loadKey: string
  summary: string
}

export interface BuildStructureFailure {
  success: false
  error: string
  /** Retained for debugging when the LLM ran but pymatgen blew up.
   *  Surface in the toast / error panel so the user can see what the
   *  model produced without a second roundtrip. */
  generatedCode?: string
  stderr?: string
}

export type BuildStructureResult = BuildStructureSuccess | BuildStructureFailure

/** Tool-call-context-shaped args for the shared implementation. The
 *  modal path synthesises a minimal context (session id + a nullable
 *  orchestrator); the agent path gets a full `ToolCallContext` from
 *  the orchestrator. */
export interface BuildStructureCtx {
  sessionId: string
  signal: AbortSignal
  orchestrator?: ToolExecutionContext['orchestrator'] | null
}

const NEVER_ABORT = new AbortController().signal

/**
 * Shared implementation. Used by the tool's `execute` and by the
 * modal's Build button directly. Returns a discriminated result so
 * callers can render their own toast / pending card without a thrown
 * error dance.
 */
export async function buildStructureDirect(
  input: BuildStructureInput,
  ctx: BuildStructureCtx,
): Promise<BuildStructureResult> {
  const description = input?.description?.trim()
  if (!description) {
    return {
      success: false,
      error: 'description is required — describe the crystal to build.',
    }
  }

  // Stage 1 — LLM → pymatgen code.
  const llm = await invokeLlmForStructureCode({
    description,
    sessionId: ctx.sessionId,
  })
  if (!llm.success || !llm.code) {
    return {
      success: false,
      error: llm.error ?? 'LLM did not return a usable pymatgen script.',
      generatedCode: llm.code,
    }
  }
  if (ctx.signal.aborted) {
    return { success: false, error: 'Cancelled', generatedCode: llm.code }
  }

  // Stage 2 — execute in compute container.
  const exec = await localProCompute.computeExec({
    code: llm.code,
    language: 'python',
    timeout_s: 90,
  })
  if (!exec.success || exec.exit_code !== 0) {
    const suffix = exec.timed_out ? ' (timed out)' : ''
    return {
      success: false,
      error:
        `pymatgen execution failed${suffix}: ` +
        (exec.error ?? exec.stderr?.trim() ?? 'non-zero exit'),
      generatedCode: llm.code,
      stderr: exec.stderr,
    }
  }
  const cif = exec.stdout?.trim()
  if (!cif) {
    return {
      success: false,
      error:
        'pymatgen script produced no stdout — the generated code must `print(structure.to(fmt="cif"))`.',
      generatedCode: llm.code,
      stderr: exec.stderr,
    }
  }

  // Stage 3 — CIF → artifact. Use `titleMode: 'formula'` so the
  // artifact title is just the formula (e.g. "BaTiO3"), not the default
  // "Structure — BaTiO3". The title slugs into the ACTIVE_CIFS key that
  // LAMMPS / CP2K cells consume via `load_structure('<key>')`; "batio3"
  // is what a materials scientist would actually type, whereas
  // "structure_batio3" or "perovskite_batio3_tetragonal" are noise.
  try {
    const result = await createStructureFromCif({
      sessionId: ctx.sessionId,
      cif,
      // Prefer caller's explicit title, else formula-only default.
      title: input.title,
      titleMode: input.title ? undefined : 'formula',
      transformKind: 'import',
      transformParams: {
        source: 'build_structure',
        description,
      },
      transformNote: `AI-built from: ${description.slice(0, 120)}`,
      orchestrator: ctx.orchestrator ?? null,
    })
    // Slug mirror of `buildRunContext` — compute once here so callers
    // (modal toast, tool_result preview, agent summary) can show the
    // user the exact key they'll type into `load_structure(...)`.
    const loadKey = slugForCifKey(
      result.artifact.title || result.formula || result.artifact.id,
    )
    return {
      success: true,
      artifactId: result.artifact.id,
      formula: result.formula,
      spaceGroup: result.spaceGroup,
      cellVolume: result.cellVolume,
      loadKey,
      summary:
        `Built ${result.formula} · ${result.spaceGroup} · ` +
        `key \`${loadKey}\` — call load_structure('${loadKey}') from a LAMMPS / CP2K cell.`,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: `CIF parse failed: ${msg}`,
      generatedCode: llm.code,
    }
  }
}

export const buildStructureTool: LocalTool<
  BuildStructureInput,
  BuildStructureResult
> = {
  name: 'build_structure',
  description:
    "Build a crystal structure artifact from a natural-language description. Calls the LLM for a pymatgen script, executes it in the compute container, and registers the resulting structure as a new artifact that's immediately available to downstream LAMMPS / CP2K / Python cells via `load_structure('<key>')` (the key is returned in `loadKey` — mention it in your reply so the user can chain it). Prefer this over asking the user to paste CIF. REQUIRES the compute container to be running.",
  trustLevel: 'localWrite',
  cardMode: 'review',
  inputSchema: {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        description:
          'Natural-language material description, e.g. "Perovskite BaTiO3 tetragonal", "2x2x2 NaCl supercell", "Diamond cubic Si". Ambiguous inputs should still produce a reasonable default — never ask the user a clarifying question before running.',
      },
      title: {
        type: 'string',
        description:
          'Optional display title. Defaults to the first 60 chars of `description`.',
      },
    },
    required: ['description'],
  },
  async execute(input, ctx) {
    return buildStructureDirect(input, {
      sessionId: ctx.sessionId,
      signal: ctx.signal ?? NEVER_ABORT,
      orchestrator: ctx.orchestrator,
    })
  },
}
