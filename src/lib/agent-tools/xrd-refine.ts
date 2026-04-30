import { localProXrd } from '../local-pro-xrd'
import type { LocalTool } from '../../types/agent-tool'
import type {
  PlotArtifact,
  PlotPayload,
  XrdProArtifact,
  XrdProRefineResult,
} from '../../types/artifact'
import { isXrdProArtifact } from '../../types/artifact'
import { genArtifactId, useRuntimeStore } from '../../stores/runtime-store'
import { patchWorkbenchPayload, requireSpectrum, resolveWorkbench } from './workbench-shared'
import { fetchCifsForMaterialIds } from '../xrd-cif-fetch'

interface Input {
  artifactId?: string
  materialIds?: string[]
  wavelength?: string
  twoThetaMin?: number
  twoThetaMax?: number
  maxPhases?: number
}

interface Output {
  artifactId: string
  plotArtifactId?: string
  rwp: number | undefined
  gof: number | undefined
  converged: boolean | undefined
  phaseCount: number
  summary: string
}

function buildRefinePlot(
  sessionId: string,
  result: XrdProRefineResult,
): PlotArtifact | null {
  const { x, y_obs, y_calc, y_diff, phases, rwp } = result
  if (!x?.length || !y_obs?.length || !y_calc?.length) return null

  const phaseLabel = phases
    .map((p) => p.phase_name ?? p.formula ?? '?')
    .join(' + ')
  const rwpLabel = rwp != null ? ` Rwp=${rwp.toFixed(2)}%` : ''

  const payload: PlotPayload = {
    mode: 'single',
    series: [
      { id: 'obs', x, y: y_obs, label: 'Observed' },
      { id: 'calc', x, y: y_calc, label: 'Calculated', dashed: true },
    ],
    peaks: [],
    references: y_diff?.length
      ? [{ x, y: y_diff, label: 'Difference', dashed: true }]
      : [],
    params: {
      title: `XRD Refinement — ${phaseLabel}${rwpLabel}`,
      xLabel: '2θ (°)',
      yLabel: 'Intensity',
      logY: false,
      showLegend: true,
      grid: true,
      journalStyle: 'minimal',
      width: 1200,
      height: 720,
    },
    sourceRelPaths: [],
  }
  const now = Date.now()
  const artifact: PlotArtifact = {
    id: genArtifactId(),
    kind: 'plot',
    title: `XRD Refinement${rwpLabel}`,
    createdAt: now,
    updatedAt: now,
    payload,
  }
  const store = useRuntimeStore.getState()
  store.upsertArtifact(sessionId, artifact)
  store.appendArtifactCardMessage(sessionId, artifact.id)
  return artifact
}

export const xrdRefineTool: LocalTool<Input, Output> = {
  name: 'xrd_refine',
  description:
    'Run XRD refinement through the repo-local Python worker using dara-xrd/BGMN. Uses candidate phases already selected on the xrd-pro workbench unless materialIds is supplied; when no CIFs were uploaded, it fetches CIF texts from the bundled Materials Project CIF database before calling xrd.refine_dara. Do not replace this with compute_run or a pymatgen script for refinement/Rietveld requests. Writes payload.refineResult and creates a plot artifact showing observed + calculated + difference curves.',
  trustLevel: 'localWrite',
  cardMode: 'info',
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: { type: 'string', description: 'xrd-pro artifact id (optional).' },
      materialIds: {
        type: 'array',
        description:
          'Material ids to include. If omitted, uses currently-selected candidates from the workbench.',
      },
      wavelength: { type: 'string', description: 'X-ray source, e.g. "Cu". Default from workbench.' },
      twoThetaMin: { type: 'number', description: '2θ lower bound.' },
      twoThetaMax: { type: 'number', description: '2θ upper bound.' },
      maxPhases: { type: 'number', description: 'Max phases in the fit. Default 3.' },
    },
  },
  async execute(input, ctx) {
    const { artifact } = resolveWorkbench(ctx.sessionId, input?.artifactId)
    if (!isXrdProArtifact(artifact)) {
      throw new Error(`xrd_refine requires an xrd-pro artifact, got ${artifact.kind}.`)
    }
    const xrd: XrdProArtifact = artifact
    const spectrum = requireSpectrum(xrd)
    const refineParams = xrd.payload.params.refinement
    const materialIds =
      input?.materialIds ??
      xrd.payload.candidates
        .filter((c) => c.selected && c.material_id)
        .map((c) => c.material_id as string)
    if (materialIds.length === 0) {
      throw new Error(
        'No phases to refine — call xrd_search_phases first or pass materialIds explicitly.',
      )
    }
    const uploadedCifs = (xrd.payload as { uploadedCifs?: Array<{ selected?: boolean; path?: string; content?: string; filename?: string }> }).uploadedCifs ?? []
    const selectedCifs = uploadedCifs.filter((c) => c.selected)
    const cifPaths = selectedCifs
      .map((c) => c.path)
      .filter((p): p is string => typeof p === 'string' && p.length > 0)
    const cifTexts = selectedCifs
      .filter((c) => typeof c.content === 'string' && c.content.length > 0)
      .map((c) => ({ filename: c.filename ?? 'phase.cif', content: c.content as string }))

    // Auto-fetch CIFs from the bundled MP database when no user-uploaded
    // CIFs are available. This bridges the gap between xrd_search_phases
    // (which returns material_ids) and dara refinement (which needs CIF
    // texts). The DB holds ~155k CIF entries covering the full MP catalog.
    if (cifPaths.length === 0 && cifTexts.length === 0) {
      try {
        const fetched = await fetchCifsForMaterialIds(materialIds)
        for (const cif of fetched) {
          if (typeof cif.content === 'string' && cif.content.length > 0) {
            cifTexts.push({
              filename: cif.filename,
              content: cif.content,
            })
          }
        }
      } catch {
        // DB unavailable — fall through to the error below
      }
    }

    if (cifPaths.length === 0 && cifTexts.length === 0) {
      throw new Error(
        'Refinement requires CIF files but none were found. Upload CIF files or ensure the MP database is available.',
      )
    }

    const res = await localProXrd.refineDara(spectrum, {
      material_ids: materialIds,
      wavelength: input?.wavelength ?? refineParams.wavelength,
      two_theta_min: input?.twoThetaMin ?? refineParams.twoThetaMin,
      two_theta_max: input?.twoThetaMax ?? refineParams.twoThetaMax,
      max_phases: input?.maxPhases ?? refineParams.maxPhases,
      cif_paths: cifPaths,
      cif_texts: cifTexts,
    })
    if (!res.success) throw new Error(res.error)
    const refineResult: XrdProRefineResult = {
      phases: res.data.phases ?? [],
      rwp: res.data.rwp,
      gof: res.data.gof,
      converged: res.data.converged,
      x: res.data.x,
      y_obs: res.data.y_obs,
      y_calc: res.data.y_calc,
      y_diff: res.data.y_diff,
    }
    patchWorkbenchPayload(ctx.sessionId, xrd, { refineResult })

    const plot = buildRefinePlot(ctx.sessionId, refineResult)

    return {
      artifactId: xrd.id,
      plotArtifactId: plot?.id,
      rwp: refineResult.rwp,
      gof: refineResult.gof,
      converged: refineResult.converged,
      phaseCount: refineResult.phases.length,
      summary:
        refineResult.rwp != null
          ? `Refined ${refineResult.phases.length} phases, Rwp=${refineResult.rwp.toFixed(2)}%`
          : `Refined ${refineResult.phases.length} phases`,
    }
  },
}
