import { localProRaman } from '../local-pro-raman'
import type { LocalTool } from '../../types/agent-tool'
import type { RamanProArtifact, RamanProMatch } from '../../types/artifact'
import { isRamanProArtifact } from '../../types/artifact'
import { patchWorkbenchPayload, resolveWorkbench } from './workbench-shared'

interface Input {
  artifactId?: string
  tolerance?: number
}

interface Output {
  artifactId: string
  matches: RamanProMatch[]
  summary: string
}

export const ramanIdentifyTool: LocalTool<Input, Output> = {
  name: 'raman_identify',
  description:
    'Match the peaks on a raman-pro workbench against the bundled Raman reference database. Requires peaks to be detected first. Writes payload.matches.',
  cardMode: 'review',
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: { type: 'string', description: 'raman-pro artifact id (optional).' },
      tolerance: { type: 'number', description: 'Peak-matching tolerance in cm⁻¹. Default ~8.' },
    },
  },
  async execute(input, ctx) {
    const { artifact } = resolveWorkbench(ctx.sessionId, input?.artifactId)
    if (!isRamanProArtifact(artifact)) {
      throw new Error(`raman_identify requires a raman-pro artifact, got ${artifact.kind}.`)
    }
    const raman: RamanProArtifact = artifact
    const peaks = raman.payload.peaks
    if (peaks.length === 0) {
      throw new Error('No peaks on the workbench — run detect_peaks first.')
    }
    const res = await localProRaman.identify({
      peaks: peaks.map((p) => ({ position: p.position, intensity: p.intensity })),
      tolerance: input?.tolerance ?? raman.payload.params.assignment.tolerance,
    })
    if (!res.success) throw new Error(res.error)
    const matches: RamanProMatch[] = (res.data?.matches ?? []).map((m) => ({
      name: m.name,
      formula: m.formula,
      score: m.score,
      matchedPeaks: m.matched_peaks,
      referencePeaks: m.reference_peaks,
    }))
    patchWorkbenchPayload(ctx.sessionId, raman, { matches })
    const top = matches
      .slice(0, 3)
      .map((m) => `${m.name}${m.score != null ? ` (${m.score.toFixed(2)})` : ''}`)
      .join(', ')
    return {
      artifactId: raman.id,
      matches,
      summary: matches.length === 0 ? 'No matches' : `${matches.length} matches; top: ${top}`,
    }
  },
}
