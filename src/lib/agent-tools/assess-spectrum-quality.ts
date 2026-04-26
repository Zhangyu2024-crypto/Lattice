import { localProSpectrum } from '../local-pro-spectrum'
import type { LocalTool } from '../../types/agent-tool'
import type { ProDataQuality } from '../../types/artifact'
import { patchWorkbenchPayload, requireSpectrum, resolveWorkbench } from './workbench-shared'

interface Input {
  artifactId?: string
}

interface Output {
  artifactId: string
  grade: ProDataQuality['grade']
  snr?: number
  nPoints?: number
  issues: string[]
  recommendations: string[]
}

export const assessSpectrumQualityTool: LocalTool<Input, Output> = {
  name: 'assess_spectrum_quality',
  description:
    'Assess SNR, noise and quality grade (good/fair/poor) of the spectrum on a Pro workbench artifact (XRD / XPS / Raman). Writes the result to payload.quality. If artifactId is omitted, uses the focused artifact.',
  trustLevel: 'localWrite',
  cardMode: 'info',
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: {
        type: 'string',
        description: 'Workbench artifact id. Omit to use the focused artifact.',
      },
    },
  },
  async execute(input, ctx) {
    const { artifact } = resolveWorkbench(ctx.sessionId, input?.artifactId)
    const spectrum = requireSpectrum(artifact)
    const res = await localProSpectrum.assessQuality(spectrum)
    if (res.success === false) throw new Error(res.error)
    const quality: ProDataQuality = {
      grade: res.grade,
      snr: res.snr,
      nPoints: res.n_points,
      issues: res.issues,
      recommendations: res.recommendations,
    }
    patchWorkbenchPayload(ctx.sessionId, artifact, { quality })
    return {
      artifactId: artifact.id,
      grade: quality.grade,
      snr: quality.snr,
      nPoints: quality.nPoints,
      issues: quality.issues,
      recommendations: quality.recommendations,
    }
  },
}
