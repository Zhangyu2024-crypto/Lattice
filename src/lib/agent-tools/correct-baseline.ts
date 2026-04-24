import type { LocalTool } from '../../types/agent-tool'
import { localProSpectrum } from '../local-pro-spectrum'
import {
  patchWorkbenchPayload,
  requireSpectrum,
  resolveWorkbench,
} from './workbench-shared'

interface Input {
  artifactId?: string
  method?: 'none' | 'linear' | 'polynomial' | 'shirley' | 'snip'
  order?: number
  iterations?: number
}

interface Output {
  artifactId: string
  method: string
  nPoints: number
  order?: number
  iterations?: number
  summary: string
}

export const correctBaselineTool: LocalTool<Input, Output> = {
  name: 'correct_baseline',
  description:
    'Subtract a baseline (linear / polynomial / Shirley / SNIP) from a workbench spectrum. Replaces the y vector with the corrected signal so subsequent peak detection sees clean peaks.',
  trustLevel: 'localWrite',
  cardMode: 'info',
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: { type: 'string' },
      method: {
        type: 'string',
        description:
          '"none" | "linear" | "polynomial" (default) | "shirley" | "snip"',
      },
      order: {
        type: 'number',
        description: 'Polynomial degree (default 3).',
      },
      iterations: {
        type: 'number',
        description: 'Iteration count for SNIP / Shirley (default 24).',
      },
    },
  },
  async execute(input, ctx) {
    const { artifact } = resolveWorkbench(ctx.sessionId, input?.artifactId)
    const spectrum = requireSpectrum(artifact)
    const res = await localProSpectrum.baseline(spectrum, {
      method: input?.method,
      order: input?.order,
      iterations: input?.iterations,
    })
    if (!res.success) throw new Error(res.error)
    patchWorkbenchPayload(ctx.sessionId, artifact, {
      spectrum: { ...spectrum, y: res.y },
    })
    return {
      artifactId: artifact.id,
      method: res.method,
      nPoints: res.y.length,
      order: input?.order,
      iterations: input?.iterations,
      summary: `Baseline corrected (${res.method})`,
    }
  },
}
