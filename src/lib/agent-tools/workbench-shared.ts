// Shared helpers for spectrum-analysis agent tools (Phase A Tier S).
//
// Each tool needs to locate the "target" artifact — usually the one the
// user currently has focused in the canvas. We standardise the lookup
// here so tool handlers stay small and share identical error messages.

import type {
  Artifact,
  ArtifactId,
  CurveProArtifact,
  ProWorkbenchSpectrum,
  RamanProArtifact,
  XpsProArtifact,
  XrdProArtifact,
} from '../../types/artifact'
import {
  isCurveProArtifact,
  isRamanProArtifact,
  isXpsProArtifact,
  isXrdProArtifact,
} from '../../types/artifact'
import { useRuntimeStore } from '../../stores/runtime-store'

export type SpectrumWorkbench =
  | XrdProArtifact
  | XpsProArtifact
  | RamanProArtifact
  | CurveProArtifact

/**
 * Resolve the workbench artifact a tool should act on. Prefers `explicitId`
 * when the LLM supplied one; otherwise falls back to the session's focused
 * artifact. Throws a human-readable error so the orchestrator feeds a
 * useful `tool_result` back to the model.
 */
export function resolveWorkbench(
  sessionId: string,
  explicitId: string | undefined,
): {
  artifact: SpectrumWorkbench
  kind: 'xrd' | 'xps' | 'raman' | 'curve'
} {
  const session = useRuntimeStore.getState().sessions[sessionId]
  if (!session) throw new Error(`Session not found: ${sessionId}`)
  const id = explicitId ?? session.focusedArtifactId
  if (!id) {
    throw new Error(
      'No artifact specified and no focused artifact in this session.',
    )
  }
  const artifact = session.artifacts[id]
  if (!artifact) throw new Error(`Artifact not found: ${id}`)
  if (isXrdProArtifact(artifact)) return { artifact, kind: 'xrd' }
  if (isXpsProArtifact(artifact)) return { artifact, kind: 'xps' }
  if (isRamanProArtifact(artifact)) return { artifact, kind: 'raman' }
  if (isCurveProArtifact(artifact)) return { artifact, kind: 'curve' }
  throw new Error(
    `Artifact ${artifact.id} is kind="${artifact.kind}"; expected xrd-pro / xps-pro / raman-pro / curve-pro.`,
  )
}

export function requireSpectrum(
  artifact: SpectrumWorkbench,
): ProWorkbenchSpectrum {
  const spectrum = artifact.payload.spectrum
  if (!spectrum || spectrum.x.length === 0) {
    throw new Error(
      `Workbench "${artifact.title}" has no spectrum loaded — import a file first.`,
    )
  }
  return spectrum
}

/** Shallow-merge a patch into a workbench's payload. */
export function patchWorkbenchPayload<A extends SpectrumWorkbench>(
  sessionId: string,
  artifact: A,
  patch: Partial<A['payload']>,
): void {
  const store = useRuntimeStore.getState()
  store.patchArtifact(sessionId, artifact.id, {
    payload: { ...artifact.payload, ...patch },
  } as Partial<Artifact>)
}

/** Extract a trimmed summary line for the agent — not for UI. */
export function summarizePeaks(
  peaks: Array<{ position: number; intensity: number }>,
): string {
  if (peaks.length === 0) return 'no peaks'
  const head = peaks
    .slice(0, 5)
    .map((p) => `${p.position.toFixed(2)}`)
    .join(', ')
  const tail = peaks.length > 5 ? `, …(+${peaks.length - 5} more)` : ''
  return `${peaks.length} peaks at ${head}${tail}`
}

export function artifactIdLabel(id: ArtifactId): string {
  return id
}
