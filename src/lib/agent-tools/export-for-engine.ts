import type { LocalTool } from '../../types/agent-tool'
import type { ExportKind } from '../compute-export-templates'
import { buildExportTemplate } from '../compute-export-templates'
import { parseCif } from '../cif/parser'
import {
  createComputeArtifact,
  ensureComputeReady,
  resolveStructureArtifact,
  runAndWait,
  structureSlug,
} from './compute-helpers'

interface Input {
  artifactId?: string
  engine: ExportKind
  autoRun?: boolean
}

interface Output {
  artifactId: string
  summary: string
  exitCode?: number | null
  stdoutTail?: string
  figureCount?: number
}

export const exportForEngineTool: LocalTool<Input, Output> = {
  name: 'export_for_engine',
  description:
    'Export a structure artifact to native LAMMPS or CP2K input format. Creates a compute artifact with the engine-specific input deck. LAMMPS exports typically need pair_style edits before running; CP2K exports are ready to run with default PBE settings. Use autoRun=false (default) for review.',
  trustLevel: 'localWrite',
  cardMode: 'edit',
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: {
        type: 'string',
        description: 'Source structure artifact. Falls back to focused.',
      },
      engine: {
        type: 'string',
        description: '"lammps" or "cp2k".',
      },
      autoRun: {
        type: 'boolean',
        description: 'Execute immediately. Default false.',
      },
    },
    required: ['engine'],
  },

  async execute(input, ctx) {
    const engine = input?.engine as ExportKind
    if (!['lammps', 'cp2k'].includes(engine)) {
      throw new Error(`Unknown engine "${engine}". Use "lammps" or "cp2k".`)
    }

    const struct = resolveStructureArtifact(ctx.sessionId, input?.artifactId)
    const slug = structureSlug(struct)
    const formula =
      (struct.payload as { formula?: string }).formula ?? struct.title

    const cifText = (struct.payload as { cif?: string }).cif
    if (!cifText) {
      throw new Error('Structure artifact has no CIF data. Re-build or re-import the structure.')
    }
    const parsed = parseCif(cifText)

    const tmpl = buildExportTemplate(engine, {
      slug,
      formula,
      parsedCif: parsed,
      parentStructureId: struct.id,
    })

    const artifact = createComputeArtifact(ctx.sessionId, {
      title: tmpl.title,
      code: tmpl.code,
      language: tmpl.cellKind === 'cp2k' ? 'cp2k' : 'python',
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
      summary: `Created "${tmpl.title}" (${engine}, idle)`,
    }
  },
}
