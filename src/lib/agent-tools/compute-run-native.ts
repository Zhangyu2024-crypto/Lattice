import type { LocalTool } from '../../types/agent-tool'
import { isComputeArtifact } from '../../types/artifact'
import { useRuntimeStore } from '../../stores/runtime-store'
import { ensureComputeReady, runAndWait } from './compute-helpers'

interface Input {
  artifactId: string
  timeoutMs?: number
}

interface Output {
  artifactId: string
  exitCode: number | null
  stdoutTail: string
  figureCount: number
  summary: string
}

const DEFAULT_TIMEOUT = 5 * 60_000
const MAX_TIMEOUT = 30 * 60_000

export const computeRunNativeTool: LocalTool<Input, Output> = {
  name: 'compute_run_native',
  description:
    'Execute a compute artifact that uses LAMMPS, CP2K, or any supported language. ' +
    'Unlike compute_run (Python-only), this tool reads the artifact\'s language field ' +
    'and dispatches to the correct engine. Use for running native LAMMPS/CP2K input decks.',
  trustLevel: 'hostExec',
  cardMode: 'review',
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: {
        type: 'string',
        description: 'Compute artifact to execute.',
      },
      timeoutMs: {
        type: 'number',
        description: `Wait timeout in ms. Default ${DEFAULT_TIMEOUT}, max ${MAX_TIMEOUT}.`,
      },
    },
    required: ['artifactId'],
  },

  async execute(input, ctx) {
    const artifactId = input?.artifactId?.trim()
    if (!artifactId) throw new Error('artifactId is required')

    const session = useRuntimeStore.getState().sessions[ctx.sessionId]
    if (!session) throw new Error('Session not found')
    const artifact = session.artifacts[artifactId]
    if (!artifact || !isComputeArtifact(artifact)) {
      throw new Error(`Artifact ${artifactId} is not a compute artifact.`)
    }
    if (!artifact.payload.code?.trim()) {
      throw new Error('Artifact has no code to run.')
    }

    await ensureComputeReady()

    const timeout = Math.min(
      MAX_TIMEOUT,
      Math.max(1000, input?.timeoutMs ?? DEFAULT_TIMEOUT),
    )

    const result = await runAndWait(ctx.sessionId, artifactId, ctx.signal, timeout)

    const lang = artifact.payload.language
    const status = result.exitCode === 0 ? 'succeeded' : 'failed'
    return {
      artifactId,
      exitCode: result.exitCode,
      stdoutTail: result.stdoutTail,
      figureCount: result.figureCount,
      summary: `${lang} run ${status} (exit ${result.exitCode})`,
    }
  },
}
