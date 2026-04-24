import type { LocalTool } from '../../types/agent-tool'
import { localProSpectrum } from '../local-pro-spectrum'
import {
  patchWorkbenchPayload,
  requireSpectrum,
  resolveWorkbench,
} from './workbench-shared'

interface Input {
  artifactId?: string
  method?: 'savgol' | 'moving_average' | 'gaussian' | 'none'
  window?: number
  order?: number
  sigma?: number
}

interface Output {
  artifactId: string
  method: string
  nPoints: number
  window?: number
  order?: number
  sigma?: number
  summary: string
}

export const smoothSpectrumTool: LocalTool<Input, Output> = {
  name: 'smooth_spectrum',
  description:
    'Apply a smoothing filter (Savitzky-Golay / Moving Average / Gaussian) to a workbench spectrum. Replaces the y vector in place so subsequent baseline / detect-peaks calls see the smoothed signal.',
  trustLevel: 'localWrite',
  cardMode: 'info',
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: {
        type: 'string',
        description: 'Workbench artifact id (optional — uses focused).',
      },
      method: {
        type: 'string',
        description: '"savgol" (default) | "moving_average" | "gaussian" | "none"',
      },
      window: {
        type: 'number',
        description: 'Window length (odd for SG; default 11).',
      },
      order: {
        type: 'number',
        description: 'Polynomial order for SG (default 3).',
      },
      sigma: {
        type: 'number',
        description: 'Gaussian σ in samples (default 1.5).',
      },
    },
  },
  async execute(input, ctx) {
    const { artifact } = resolveWorkbench(ctx.sessionId, input?.artifactId)
    const spectrum = requireSpectrum(artifact)
    const res = await localProSpectrum.smooth(spectrum, {
      method: input?.method,
      window: input?.window,
      order: input?.order,
      sigma: input?.sigma,
    })
    if (!res.success) throw new Error(res.error)
    // Mount the new y back onto the spectrum so the chart updates.
    patchWorkbenchPayload(ctx.sessionId, artifact, {
      spectrum: { ...spectrum, y: res.y },
    })
    return {
      artifactId: artifact.id,
      method: res.method,
      nPoints: res.y.length,
      window: input?.window,
      order: input?.order,
      sigma: input?.sigma,
      summary: `Smoothed (${res.method}, ${res.y.length} points)`,
    }
  },
}
