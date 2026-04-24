import type { LocalTool } from '../../types/agent-tool'
import {
  buildSupercellTweak,
  buildDopeTweak,
  buildSurfaceTweak,
  buildVacancyTweak,
} from '../compute-tweak-templates'
import {
  createComputeArtifact,
  ensureComputeReady,
  resolveStructureArtifact,
  runAndWait,
  structureSlug,
} from './compute-helpers'

type TweakKind = 'supercell' | 'dope' | 'surface' | 'vacancy'

interface Input {
  artifactId?: string
  tweakKind: TweakKind
  params: Record<string, unknown>
  autoRun?: boolean
}

interface Output {
  artifactId: string
  summary: string
  exitCode?: number | null
  stdoutTail?: string
  figureCount?: number
}

export const structureTweakTool: LocalTool<Input, Output> = {
  name: 'structure_tweak',
  description:
    'Apply a parametric structure modification via pymatgen in the compute container. ' +
    'Kinds: "supercell" (params: {nx,ny,nz}), "dope" (params: {fromElement,toElement,fraction?}), ' +
    '"surface" (params: {miller:[h,k,l],minSlab,minVacuum}), "vacancy" (params: {element,count?,seed?}). ' +
    'Prefer structure_modify for simple supercell/element-replace (no container needed). ' +
    'Use this tool for surface slabs, vacancies, and partial doping.',
  trustLevel: 'localWrite',
  cardMode: 'edit',
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: {
        type: 'string',
        description: 'Source structure artifact. Falls back to focused.',
      },
      tweakKind: {
        type: 'string',
        description: '"supercell", "dope", "surface", or "vacancy".',
      },
      params: {
        type: 'object',
        description:
          'Tweak-specific params. supercell: {nx,ny,nz}. dope: {fromElement,toElement,fraction?}. surface: {miller:[h,k,l],minSlab,minVacuum}. vacancy: {element,count?,seed?}.',
      },
      autoRun: {
        type: 'boolean',
        description: 'Execute immediately. Default true.',
      },
    },
    required: ['tweakKind', 'params'],
  },

  async execute(input, ctx) {
    const kind = input?.tweakKind as TweakKind
    if (!['supercell', 'dope', 'surface', 'vacancy'].includes(kind)) {
      throw new Error(`Unknown tweakKind "${kind}".`)
    }
    const params = (input?.params ?? {}) as Record<string, unknown>

    const struct = resolveStructureArtifact(ctx.sessionId, input?.artifactId)
    const slug = structureSlug(struct)

    let result: { title: string; code: string }
    switch (kind) {
      case 'supercell':
        result = buildSupercellTweak(slug, {
          nx: Number(params.nx ?? 2),
          ny: Number(params.ny ?? 2),
          nz: Number(params.nz ?? 2),
        })
        break
      case 'dope':
        result = buildDopeTweak(slug, {
          fromElement: String(params.fromElement ?? ''),
          toElement: String(params.toElement ?? ''),
          fraction: Number(params.fraction ?? 0.25),
        })
        break
      case 'surface':
        result = buildSurfaceTweak(slug, {
          miller: (params.miller as [number, number, number]) ?? [1, 0, 0],
          minSlab: Number(params.minSlab ?? 10),
          minVacuum: Number(params.minVacuum ?? 15),
        })
        break
      case 'vacancy':
        result = buildVacancyTweak(slug, {
          element: String(params.element ?? ''),
          count: Number(params.count ?? 1),
          seed: Number(params.seed ?? 0),
        })
        break
    }

    const artifact = createComputeArtifact(ctx.sessionId, {
      title: result.title,
      code: result.code,
      language: 'python',
    })

    const shouldRun = input?.autoRun !== false
    if (shouldRun) {
      await ensureComputeReady()
      const run = await runAndWait(ctx.sessionId, artifact.id, ctx.signal)
      return {
        artifactId: artifact.id,
        summary: `${result.title} — exit ${run.exitCode}`,
        ...run,
      }
    }

    return {
      artifactId: artifact.id,
      summary: `Created "${result.title}" (idle)`,
    }
  },
}
