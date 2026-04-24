import type { LocalTool } from '../../types/agent-tool'
import { createStructureFromCif } from '../structure-builder'

interface Input {
  cif: string
  title?: string
}

interface SuccessOutput {
  success: true
  artifactId: string
  formula: string
  cellVolume: number
  spaceGroup: string
  summary: string
}

interface ErrorOutput {
  success: false
  error: string
}

type Output = SuccessOutput | ErrorOutput

export const structureFromCifTool: LocalTool<Input, Output> = {
  name: 'structure_from_cif',
  description:
    'Create a structure artifact from a CIF string. Parses lattice parameters, atom sites, and space group via the offline CIF parser (no pymatgen required). Returns the new artifact id plus a short summary.',
  trustLevel: 'localWrite',
  cardMode: 'info',
  inputSchema: {
    type: 'object',
    properties: {
      cif: {
        type: 'string',
        description: 'Raw CIF content — must include cell parameters and an atom-site loop.',
      },
      title: {
        type: 'string',
        description: 'Optional display title. Defaults to "Structure — <formula>".',
      },
    },
    required: ['cif'],
  },
  async execute(input, ctx) {
    if (!input?.cif || typeof input.cif !== 'string') {
      return { success: false, error: 'cif is required (string)' }
    }
    try {
      const result = await createStructureFromCif({
        sessionId: ctx.sessionId,
        cif: input.cif,
        title: input.title,
        transformKind: 'import',
        transformParams: { source: 'structure_from_cif' },
        transformNote: 'Imported from CIF',
        orchestrator: ctx.orchestrator,
      })
      const summary =
        `Created structure ${result.formula} (${result.atomCount} atoms, ` +
        `space group ${result.spaceGroup}, V=${result.cellVolume.toFixed(2)} Å³)`
      return {
        success: true,
        artifactId: result.artifact.id,
        formula: result.formula,
        cellVolume: result.cellVolume,
        spaceGroup: result.spaceGroup,
        summary,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: `CIF parse failed: ${msg}` }
    }
  },
}
