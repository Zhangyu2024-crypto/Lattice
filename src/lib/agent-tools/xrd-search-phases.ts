import type { LocalTool } from '../../types/agent-tool'
import type {
  XrdProArtifact,
  XrdProCandidate,
  XrdProIdentification,
} from '../../types/artifact'
import { isXrdProArtifact } from '../../types/artifact'
import { identifyPhases } from '../xrd-phase-identification'
import {
  patchWorkbenchPayload,
  requireSpectrum,
  resolveWorkbench,
} from './workbench-shared'

interface Input {
  artifactId?: string
  /** REQUIRED. Element symbols known to be in the sample ("Fe","O").
   *  Seeds both the retriever's filter and the multi-phase subset
   *  expansion. Without these, retrieval can only browse the bundled
   *  JSON fallback and the result is too broad to act on. */
  elements: string[]
  tolerance?: number
  topK?: number
  wavelength?: string
}

interface Output {
  artifactId: string
  candidates: XrdProCandidate[]
  identification: XrdProIdentification
  source: string
  summary: string
  elements: string[]
  experimentalPeaks: { position: number; intensity: number }[]
  spectrumCurve?: { x: number[]; y: number[] }
}

export const xrdSearchPhasesTool: LocalTool<Input, Output> = {
  name: 'xrd_search_phases',
  description:
    'Identify crystalline phases in an xrd-pro workbench by combining the element list + detected peaks. Pipeline: worker-side element subset expansion (Fe+Ti+O → also queries {Fe,O}, {Ti,O}, {Fe,Ti,O}, …) against the Materials Project DB, then LLM adjudication over the top candidates. Writes `candidates` + `identification` to payload. REQUIRES `elements` — ALWAYS ask the user which elements are present in the sample before calling this tool. Do NOT guess or infer elements from the filename. The user must explicitly confirm the element list.',
  trustLevel: 'localWrite',
  cardMode: 'review',
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: { type: 'string', description: 'xrd-pro artifact id (optional; falls back to active workbench).' },
      elements: {
        type: 'array',
        description:
          'REQUIRED. Element symbols in the sample, e.g. ["Fe","O"]. Drives both the DB filter and the multi-phase subset expansion; without it the search returns an error.',
      },
      tolerance: { type: 'number', description: 'Peak-matching tolerance in 2θ degrees. Default ~0.3.' },
      topK: { type: 'number', description: 'Max candidates to send to the LLM. Default ~20.' },
      wavelength: {
        type: 'string',
        description: 'X-ray source — "Cu", "Mo", "Co", etc. Default Cu (Materials Project DB only supports Cu at the moment).',
      },
    },
    required: ['elements'],
  },
  async execute(input, ctx) {
    const { artifact } = resolveWorkbench(ctx.sessionId, input?.artifactId)
    if (!isXrdProArtifact(artifact)) {
      throw new Error(`xrd_search_phases requires an xrd-pro artifact, got ${artifact.kind}.`)
    }
    const xrd: XrdProArtifact = artifact
    const spectrum = requireSpectrum(xrd)

    const elements = Array.isArray(input?.elements)
      ? input.elements.map((s) => s.trim()).filter((s) => s.length > 0)
      : []
    if (elements.length === 0) {
      throw new Error(
        'elements is required. Provide the element symbols known to be in the sample (e.g. ["Fe","O"]); without it the retriever cannot narrow the 155k-row Materials Project DB.',
      )
    }
    const result = await identifyPhases({
      sessionId: ctx.sessionId,
      spectrum,
      peaks: xrd.payload.peaks,
      elements,
      tolerance: input?.tolerance,
      topK: input?.topK,
      wavelength: input?.wavelength ?? xrd.payload.params.refinement.wavelength,
    })
    if (!result.success) throw new Error(result.error)

    // Flag the LLM's predicted phases as `selected` on the candidate
    // list so the workbench UI highlights them without a second click.
    const predictedSet = new Set(result.identification.predictedPhases)
    const candidates: XrdProCandidate[] = result.candidates.map((c) => ({
      ...c,
      selected: c.material_id ? predictedSet.has(c.material_id) : false,
    }))

    patchWorkbenchPayload(ctx.sessionId, xrd, {
      candidates,
      identification: result.identification,
    })

    const top = candidates
      .slice(0, 3)
      .map((c) => `${c.formula ?? c.name ?? '?'} (${c.score?.toFixed(2) ?? '—'})`)
      .join(', ')
    const verdict =
      result.identification.predictedPhases.length > 0
        ? `LLM picked ${result.identification.predictedPhases.length} phase(s) @ ${(
            result.identification.confidence * 100
          ).toFixed(0)}% confidence`
        : 'LLM made no prediction'
    const experimentalPeaks = (xrd.payload.peaks ?? []).map((p) => ({
      position: p.position,
      intensity: p.intensity,
    }))

    // Downsample spectrum curve for the preview card (max ~500 points)
    const rawX = spectrum?.x ?? []
    const rawY = spectrum?.y ?? []
    const step = Math.max(1, Math.floor(rawX.length / 500))
    const spectrumCurve =
      rawX.length > 0
        ? {
            x: rawX.filter((_, i) => i % step === 0),
            y: rawY.filter((_, i) => i % step === 0),
          }
        : undefined

    return {
      artifactId: xrd.id,
      candidates,
      identification: result.identification,
      source: result.source,
      summary: `${candidates.length} candidates${candidates.length > 0 ? `; top: ${top}` : ''} · ${verdict}`,
      elements,
      experimentalPeaks,
      spectrumCurve,
    }
  },
}
