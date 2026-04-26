import { localProXps } from '../local-pro-xps'
import type { LocalTool } from '../../types/agent-tool'
import type { XpsProArtifact, XpsProFitResult, XpsProPeakDef } from '../../types/artifact'
import type { XpsFitComponent } from '../../types/pro-api'
import { isXpsProArtifact } from '../../types/artifact'
import { patchWorkbenchPayload, requireSpectrum, resolveWorkbench } from './workbench-shared'

interface Input {
  artifactId?: string
  background?: 'shirley' | 'linear'
  method?: 'least_squares' | 'leastsq' | 'nelder'
  energyRange?: [number, number]
}

interface Output {
  artifactId: string
  components: number
  componentDetails?: XpsFitComponent[]
  rSquared?: number
  reducedChiSquared?: number
  summary: string
}

function peakDefToSpec(d: XpsProPeakDef) {
  return {
    name: d.label,
    center: d.position,
    fwhm: d.fwhm,
    amplitude: d.intensity,
    vary_center: !d.fixedPosition,
    vary_fwhm: !d.fixedFwhm,
  }
}

export const xpsFitPeaksTool: LocalTool<Input, Output> = {
  name: 'xps_fit_peaks',
  description:
    'Fit peaks on an xps-pro workbench using the Voigt/pseudo-Voigt + Shirley/linear/Tougaard background. Consumes payload.peakDefinitions — add peaks in the UI or let the model build the list via the workbench first. Writes payload.fitResult.',
  trustLevel: 'localWrite',
  cardMode: 'edit',
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: { type: 'string' },
      background: {
        type: 'string',
        description: '"shirley", "linear", or "tougaard" (approx U3 universal).',
      },
      method: { type: 'string', description: '"least_squares" / "leastsq" / "nelder".' },
      energyRange: { type: 'array', description: 'Optional [min,max] eV window to fit.' },
    },
  },
  async execute(input, ctx) {
    const { artifact } = resolveWorkbench(ctx.sessionId, input?.artifactId)
    if (!isXpsProArtifact(artifact)) {
      throw new Error(`xps_fit_peaks requires an xps-pro artifact, got ${artifact.kind}.`)
    }
    const xps: XpsProArtifact = artifact
    const spectrum = requireSpectrum(xps)
    const defs = xps.payload.peakDefinitions
    if (defs.length === 0) {
      throw new Error('No peak definitions on the workbench — add peaks before fitting.')
    }
    const singles = defs.filter((d) => d.type === 'single').map(peakDefToSpec)
    const doublets = defs
      .filter((d) => d.type === 'doublet')
      .map((d) => ({
        base_name: d.label,
        center: d.position,
        split: d.split ?? 0,
        area_ratio: d.branchingRatio ?? 0.5,
        fwhm: d.fwhm,
        amplitude: d.intensity,
      }))
    const fitP = xps.payload.params.fit
    const res = await localProXps.fit(spectrum, {
      peaks: singles,
      doublets,
      background: input?.background ?? fitP.background,
      method: input?.method ?? fitP.method,
      energy_range: input?.energyRange,
    })
    if (!res.success) throw new Error(res.error)
    const prev = xps.payload.fitResult ?? {}
    const fitResult: XpsProFitResult = {
      ...prev,
      curves: res.curves,
      data: res.data,
    }
    patchWorkbenchPayload(ctx.sessionId, xps, { fitResult })
    const stats = res.fit_statistics
    const componentCount = res.components?.length ?? 0
    return {
      artifactId: xps.id,
      components: componentCount,
      componentDetails: res.components,
      rSquared: stats?.r_squared,
      reducedChiSquared: stats?.reduced_chi_squared,
      summary: `Fit ${componentCount} components${
        stats?.r_squared != null ? `, R²=${stats.r_squared.toFixed(3)}` : ''
      }`,
    }
  },
}
