import { localProCompute } from '../../lib/local-pro-compute'
import { invokeLlmForStructureCode } from '../../lib/llm-client'
import type { ComputeProRun } from '../../types/artifact'
import type { RunContainerArgs, RunStructureArgs } from './types'

export async function runContainerScript({
  code,
  language,
  timeoutS,
  runId,
  startedAt,
}: RunContainerArgs): Promise<ComputeProRun> {
  const r = await localProCompute.computeExec({
    code,
    language,
    timeout_s: timeoutS,
  })
  return {
    id: runId,
    cellKind: language,
    startedAt,
    endedAt: Date.now(),
    exitCode: r.exit_code,
    timedOut: r.timed_out,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    figures: (r.figures ?? []).map((f) => ({
      format: f.format,
      base64: f.base64,
      caption: f.caption,
    })),
    durationMs: r.duration_ms,
    error: r.error,
  }
}

/**
 * @deprecated — kept only for backward compatibility with notebooks
 * saved before the Add Structure modal replaced the `structure-ai`
 * cell kind. New "build a crystal" intents go through
 * `src/lib/agent-tools/build-structure.ts` (agent tool) or its
 * `buildStructureDirect` export (UI modal); neither produces a cell.
 *
 * Two-stage LLM-to-structure build.
 *
 *   1. Ask the LLM for a pymatgen Python script that prints CIF to
 *      stdout. We store the emitted code on the run so the cell UI can
 *      surface it as an editable / copyable artifact — a major step up
 *      from the old "direct CIF from LLM" flow which gave the user
 *      nothing to iterate on when the model got a structure wrong.
 *   2. Execute that code in the compute container. stdout lands with
 *      the CIF (same shape as the old path), so the downstream
 *      `StructureOutput` preview + 3D viewer work unchanged.
 *
 * Errors from either stage surface on `stderr` with a clear header so
 * the user can tell whether the model failed or pymatgen did.
 */
export async function runStructureBuild({
  description,
  sessionId,
  artifactTitle,
  runId,
  startedAt,
  timeoutS,
}: RunStructureArgs): Promise<ComputeProRun> {
  // Stage 1 — LLM generates Python.
  const llm = await invokeLlmForStructureCode({
    description,
    sessionId,
    artifactTitle,
  })
  if (!llm.success || !llm.code) {
    const endedAt = Date.now()
    const stderrParts: string[] = []
    if (!llm.success && llm.error) stderrParts.push(llm.error)
    if (llm.rawContent) stderrParts.push(`Raw reply:\n${llm.rawContent}`)
    return {
      id: runId,
      cellKind: 'structure-ai',
      startedAt,
      endedAt,
      exitCode: 1,
      timedOut: false,
      stdout: '',
      stderr:
        stderrParts.length > 0
          ? `[LLM] ${stderrParts.join('\n\n')}`
          : '[LLM] Structure build failed.',
      figures: [],
      durationMs: endedAt - startedAt,
      error: llm.error ?? 'Structure build failed',
    }
  }

  // Stage 2 — execute the emitted Python in the compute container.
  const container = await runContainerScript({
    code: llm.code,
    language: 'python',
    timeoutS,
    runId,
    startedAt,
  })
  return {
    ...container,
    cellKind: 'structure-ai',
    generatedCode: llm.code,
    // Prefix the stderr source so the user can tell whether failure
    // was in the model's code vs. pymatgen vs. import. Keep empty when
    // the run succeeded.
    stderr:
      container.stderr && container.stderr.trim().length > 0
        ? `[pymatgen]\n${container.stderr}`
        : '',
  }
}
