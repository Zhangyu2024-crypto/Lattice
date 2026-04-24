// Spectrum helpers that bridge the plain `SpectrumPayload` artifact shape
// and the richer `ProWorkbenchSpectrum` tuple carried around by workbenches.

import type {
  ProWorkbenchSpectrum,
  SpectrumPayload,
} from '../../types/artifact'
import { useRuntimeStore } from '../../stores/runtime-store'

/** Convert a plain spectrum artifact payload into the workbench-friendly
 *  tuple, copying arrays so later mutations on one side don't bleed into
 *  the other. */
export function spectrumPayloadToProSpectrum(
  payload: SpectrumPayload,
  sourceFile?: string | null,
): ProWorkbenchSpectrum {
  return {
    x: payload.x.slice(),
    y: payload.y.slice(),
    xLabel: payload.xLabel,
    yLabel: payload.yLabel,
    spectrumType: payload.spectrumType,
    sourceFile: sourceFile ?? null,
  }
}

/**
 * Best-effort lookup of the latest spectrum artifact in a session, used by
 * entry points that open a workbench without an explicit source (e.g. the
 * "XRD: Open Pro Workbench" command palette entry).
 */
export function latestSpectrumFromSession(
  sessionId: string,
): ProWorkbenchSpectrum | null {
  const store = useRuntimeStore.getState()
  const session = store.sessions[sessionId]
  if (!session) return null
  for (let i = session.artifactOrder.length - 1; i >= 0; i--) {
    const a = session.artifacts[session.artifactOrder[i]]
    if (a && a.kind === 'spectrum') {
      return spectrumPayloadToProSpectrum(
        a.payload,
        a.sourceFile ?? null,
      )
    }
  }
  return null
}
