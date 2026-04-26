import type { LocalTool } from '../../types/agent-tool'
import type { XpsProArtifact } from '../../types/artifact'
import { isXpsProArtifact } from '../../types/artifact'
import { localProXps } from '../local-pro-xps'
import type { XpsValidateDetail, XpsValidateOverlapWarning } from '../local-pro-xps'
import { patchWorkbenchPayload, resolveWorkbench } from './workbench-shared'

interface Input {
  artifactId?: string
  elements: string[]
  tolerance_eV?: number
  tolerance_eV_secondary?: number
  overlap_threshold_eV?: number
}

interface Output {
  artifactId: string
  confirmed: string[]
  rejected: string[]
  chargeShiftEV: number
  details: XpsValidateDetail[]
  overlapWarnings: XpsValidateOverlapWarning[]
  summary: string
}

export const xpsValidateElementsTool: LocalTool<Input, Output> = {
  name: 'xps_validate_elements',
  description:
    'Validate XPS element assignments against a curated binding-energy reference database (90+ elements, 500+ peaks). '
    + 'Applies automatic charge correction (C 1s calibration), matches predicted elements\' reference peaks against '
    + 'detected peaks, and classifies each element as confirmed/rejected based on a 4-tier rarity system '
    + '(common/uncommon/rare/very_rare) with close-doublet element handling. '
    + 'MUST be called after element identification (lookup) to verify predictions before proceeding to chemical state analysis. '
    + 'Elements with status "rejected" should be removed; "weak_match" should be marked as tentative.',
  trustLevel: 'localWrite',
  cardMode: 'review',
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: {
        type: 'string',
        description: 'xps-pro artifact id (optional; falls back to active workbench).',
      },
      elements: {
        type: 'array',
        description:
          'Element symbols to validate, e.g. ["Fe", "O", "C", "Ti"]. '
          + 'These are typically the elements identified by xps.lookup or predicted by the LLM.',
      },
      tolerance_eV: {
        type: 'number',
        description: 'Primary peak matching tolerance in eV. Default 1.0.',
      },
      tolerance_eV_secondary: {
        type: 'number',
        description: 'Secondary/support peak matching tolerance in eV. Default 1.5.',
      },
      overlap_threshold_eV: {
        type: 'number',
        description: 'Peak overlap detection threshold in eV. Default 0.5.',
      },
    },
    required: ['elements'],
  },
  async execute(input, ctx) {
    const { artifact } = resolveWorkbench(ctx.sessionId, input?.artifactId)
    if (!isXpsProArtifact(artifact)) {
      throw new Error(`xps_validate_elements requires an xps-pro artifact, got ${artifact.kind}.`)
    }
    const xps: XpsProArtifact = artifact

    const peaks = (xps.payload.detectedPeaks ?? []).map((p) => ({
      position: p.position,
      intensity: p.intensity,
      prominence: p.intensity,
    }))
    if (peaks.length === 0) {
      throw new Error(
        'No detected peaks on the workbench. Run detect_peaks first so there are peaks to validate against.',
      )
    }

    const elements = Array.isArray(input?.elements)
      ? input.elements.map((s) => s.trim()).filter((s) => s.length > 0)
      : []
    if (elements.length === 0) {
      throw new Error('elements is required — provide the element symbols to validate.')
    }

    const result = await localProXps.validate({
      elements,
      peaks,
      tolerance_eV: input?.tolerance_eV,
      tolerance_eV_secondary: input?.tolerance_eV_secondary,
      overlap_threshold_eV: input?.overlap_threshold_eV,
    })
    if (!result.success || !result.data) {
      throw new Error(result.error ?? 'Validation failed')
    }

    const { confirmed, rejected, charge_shift_eV, details, overlap_warnings } = result.data

    patchWorkbenchPayload(ctx.sessionId, xps, {
      validationResult: {
        confirmed,
        rejected,
        chargeShiftEV: charge_shift_eV,
        details,
        overlapWarnings: overlap_warnings,
        createdAt: Date.now(),
      },
    })

    return {
      artifactId: xps.id,
      confirmed,
      rejected,
      chargeShiftEV: charge_shift_eV,
      details,
      overlapWarnings: overlap_warnings,
      summary: result.summary ?? `${confirmed.length} confirmed, ${rejected.length} rejected`,
    }
  },
}
