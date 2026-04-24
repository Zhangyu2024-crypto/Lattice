import type { LocalTool } from '../../types/agent-tool'
import type { SimulateKind } from '../compute-simulate-templates'
import { buildSimulateTemplate } from '../compute-simulate-templates'
import {
  createComputeArtifact,
  ensureComputeReady,
  resolveStructureArtifact,
  runAndWait,
  structureSlug,
} from './compute-helpers'

interface Input {
  artifactId?: string
  simulationKind: SimulateKind
  autoRun?: boolean
}

interface Output {
  artifactId: string
  summary: string
  exitCode?: number | null
  stdoutTail?: string
  figureCount?: number
}

export const simulateStructureTool: LocalTool<Input, Output> = {
  name: 'simulate_structure',
  description:
    'Launch a simulation on a structure artifact. Kinds: "md-ase" (molecular dynamics with ASE Langevin), "dft-cp2k" (DFT single-point via CP2K/pymatgen bridge), "py-play" (pymatgen playground seeded with the structure). Creates a compute artifact from the built-in template.',
  trustLevel: 'localWrite',
  cardMode: 'edit',
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: {
        type: 'string',
        description: 'Source structure artifact. Falls back to focused artifact.',
      },
      simulationKind: {
        type: 'string',
        description: '"md-ase", "dft-cp2k", or "py-play".',
      },
      autoRun: {
        type: 'boolean',
        description: 'Execute immediately. Default false (creates draft for review).',
      },
    },
    required: ['simulationKind'],
  },

  async execute(input, ctx) {
    const kind = input?.simulationKind as SimulateKind
    if (!['md-ase', 'dft-cp2k', 'py-play'].includes(kind)) {
      throw new Error(`Unknown simulationKind "${kind}". Use md-ase, dft-cp2k, or py-play.`)
    }

    const struct = resolveStructureArtifact(ctx.sessionId, input?.artifactId)
    const slug = structureSlug(struct)
    const formula =
      (struct.payload as { formula?: string }).formula ?? struct.title

    const tmpl = buildSimulateTemplate(kind, {
      slug,
      formula,
      parentStructureId: struct.id,
    })

    const artifact = createComputeArtifact(ctx.sessionId, {
      title: tmpl.title,
      code: tmpl.code,
      language: 'python',
    })

    if (input?.autoRun) {
      await ensureComputeReady()
      const result = await runAndWait(ctx.sessionId, artifact.id, ctx.signal)
      return {
        artifactId: artifact.id,
        summary: `${tmpl.title} — exit ${result.exitCode}`,
        ...result,
      }
    }

    return {
      artifactId: artifact.id,
      summary: `Created "${tmpl.title}" (idle, ready to run)`,
    }
  },
}
