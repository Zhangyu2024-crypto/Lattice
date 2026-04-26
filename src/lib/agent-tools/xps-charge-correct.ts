import { localProXps } from '../local-pro-xps'
import type { LocalTool } from '../../types/agent-tool'
import type { XpsProArtifact } from '../../types/artifact'
import { isXpsProArtifact } from '../../types/artifact'
import { patchWorkbenchPayload, requireSpectrum, resolveWorkbench } from './workbench-shared'

interface Input {
  artifactId?: string
  mode?: 'auto' | 'manual'
  referenceEV?: number
  manualShift?: number
  searchRange?: [number, number]
}

interface Output {
  artifactId: string
  shiftEV: number
  c1sFoundEV?: number
  summary: string
}

export const xpsChargeCorrectTool: LocalTool<Input, Output> = {
  name: 'xps_charge_correct',
  description:
    'Apply XPS charge correction to an xps-pro workbench. Auto mode finds the C 1s adventitious peak near 284.8 eV; manual mode applies the explicit shift. Writes payload.chargeCorrection.',
  trustLevel: 'localWrite',
  cardMode: 'review',
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: { type: 'string', description: 'xps-pro artifact id (optional).' },
      mode: { type: 'string', description: '"auto" or "manual". Default "auto".' },
      referenceEV: { type: 'number', description: 'C 1s reference energy for auto mode. Default 284.8.' },
      manualShift: { type: 'number', description: 'Shift in eV for manual mode.' },
      searchRange: { type: 'array', description: '[min,max] window to search in auto mode.' },
    },
  },
  async execute(input, ctx) {
    const { artifact } = resolveWorkbench(ctx.sessionId, input?.artifactId)
    if (!isXpsProArtifact(artifact)) {
      throw new Error(`xps_charge_correct requires an xps-pro artifact, got ${artifact.kind}.`)
    }
    const xps: XpsProArtifact = artifact
    const spectrum = requireSpectrum(xps)
    const cc = xps.payload.params.chargeCorrect
    const res = await localProXps.chargeCorrect(spectrum, {
      mode: input?.mode ?? cc.mode,
      reference_eV: input?.referenceEV ?? cc.referenceEV,
      manual_shift: input?.manualShift ?? cc.manualShift,
      search_range: input?.searchRange ?? cc.searchRange,
    })
    if (!res.success) throw new Error(res.error)
    patchWorkbenchPayload(ctx.sessionId, xps, {
      chargeCorrection: {
        shiftEV: res.shift_eV,
        c1sFoundEV: res.c1s_found_eV,
      },
    })
    return {
      artifactId: xps.id,
      shiftEV: res.shift_eV,
      c1sFoundEV: res.c1s_found_eV,
      summary: `Applied shift ${res.shift_eV.toFixed(2)} eV${
        res.c1s_found_eV != null ? ` (C 1s @ ${res.c1s_found_eV.toFixed(2)})` : ''
      }`,
    }
  },
}
