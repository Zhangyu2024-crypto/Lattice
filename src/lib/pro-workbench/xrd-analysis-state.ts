import type {
  XrdAnalysisPayload,
  XrdSubState,
} from '../../types/artifact'
import { defaultXrdProPayload } from './defaults'

export function xrdAnalysisToInitialState(
  payload: XrdAnalysisPayload,
): Partial<XrdSubState> {
  const base = defaultXrdProPayload(null)
  const [twoThetaMin, twoThetaMax] = payload.query.range

  return {
    params: {
      ...base.params,
      refinement: {
        ...base.params.refinement,
        twoThetaMin,
        twoThetaMax,
      },
    },
    candidates: payload.phases.map((phase) => ({
      material_id: phase.cifRef ?? undefined,
      formula: phase.formula || undefined,
      space_group: phase.spaceGroup || undefined,
      name: phase.name || phase.formula || phase.cifRef || undefined,
      score:
        Number.isFinite(phase.confidence) && phase.confidence > 0
          ? phase.confidence
          : undefined,
      weight_pct:
        typeof phase.weightFraction === 'number'
          ? phase.weightFraction * 100
          : undefined,
      selected: true,
    })),
    refineResult: payload.rietveld
      ? {
          phases: payload.phases.map((phase) => ({
            phase_name: phase.name || phase.formula || undefined,
            formula: phase.formula || undefined,
            hermann_mauguin: phase.spaceGroup || undefined,
            weight_pct:
              typeof phase.weightFraction === 'number'
                ? phase.weightFraction * 100
                : undefined,
            confidence:
              Number.isFinite(phase.confidence) && phase.confidence > 0
                ? phase.confidence
                : undefined,
          })),
          rwp: payload.rietveld.rwp,
          gof: payload.rietveld.gof,
          converged: payload.rietveld.converged,
        }
      : null,
  }
}
