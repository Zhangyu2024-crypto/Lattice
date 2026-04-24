// Snapshot helpers: freeze a Pro workbench's current state into one of the
// read-only analysis artifact kinds. The workbench itself is left untouched
// so the user can keep iterating after taking a snapshot.

import type {
  ArtifactId,
  XrdAnalysisArtifact,
  XrdAnalysisPayload,
  XrdProArtifact,
} from '../../types/artifact'
import { genArtifactId, useRuntimeStore } from '../../stores/runtime-store'

/**
 * Clone an XRD workbench's current state into a read-only `xrd-analysis`
 * snapshot artifact. The workbench itself is left untouched.
 */
export function snapshotXrdWorkbench(
  sessionId: string,
  workbench: XrdProArtifact,
): ArtifactId | null {
  if (!workbench.payload.spectrum || workbench.payload.peaks.length === 0) {
    return null
  }
  const store = useRuntimeStore.getState()
  const spec = workbench.payload.spectrum
  const refine = workbench.payload.refineResult
  // Offline-v1 is an approximate isotropic fit, not full Rietveld — be
  // honest in the snapshot so downstream cards don't mislabel the
  // analysis method.
  const method = refine
    ? ('approximate-fit' as const)
    : ('peak-match' as const)

  // Build phases from the refinement result when present, otherwise from
  // the candidates the user selected. Each snapshot phase needs an id for
  // the PhaseList UI in XrdAnalysisCard.
  const phases = refine
    ? refine.phases.map((p, i) => ({
        id: `ph_${i}`,
        name: p.phase_name ?? `Phase ${i + 1}`,
        formula: p.phase_name ?? '',
        spaceGroup: p.hermann_mauguin ?? '—',
        cifRef: null,
        confidence: p.confidence ?? 1,
        weightFraction:
          p.weight_pct != null ? p.weight_pct / 100 : null,
        matchedPeaks: [],
      }))
    : workbench.payload.candidates.map((c, i) => ({
        id: `cand_${i}`,
        name: c.name ?? c.formula ?? `Candidate ${i + 1}`,
        formula: c.formula ?? '',
        spaceGroup: c.space_group ?? '—',
        cifRef: (c.material_id as string | undefined) ?? null,
        confidence: c.score ?? 0.5,
        weightFraction: null,
        matchedPeaks: [],
      }))

  const payload: XrdAnalysisPayload = {
    query: {
      range: [
        workbench.payload.params.refinement.twoThetaMin,
        workbench.payload.params.refinement.twoThetaMax,
      ],
      method,
    },
    experimentalPattern: {
      x: spec.x.slice(),
      y: spec.y.slice(),
      xLabel: spec.xLabel,
      yLabel: spec.yLabel,
    },
    phases,
    rietveld:
      refine && refine.rwp != null
        ? {
            rwp: refine.rwp,
            gof: refine.gof ?? 0,
            converged: refine.converged ?? true,
          }
        : null,
  }

  const id = genArtifactId()
  const now = Date.now()
  const snapshot: XrdAnalysisArtifact = {
    id,
    kind: 'xrd-analysis',
    title: 'XRD Analysis Snapshot',
    createdAt: now,
    updatedAt: now,
    sourceFile: spec.sourceFile ?? workbench.sourceFile ?? null,
    parents: [workbench.id],
    payload,
  }
  store.upsertArtifact(sessionId, snapshot)
  store.focusArtifact(sessionId, id)
  return id
}
