import { useRuntimeStore } from '../../stores/runtime-store'
import type {
  ComputeCellProvenance,
  ComputeProArtifact,
  ComputeProPayload,
  ComputeProRun,
} from '../../types/artifact'

export function getFreshArtifact(
  sessionId: string,
  artifactId: string,
): ComputeProArtifact | null {
  const s = useRuntimeStore.getState()
  const a = s.sessions[sessionId]?.artifacts[artifactId]
  if (!a || a.kind !== 'compute-pro') return null
  return a as ComputeProArtifact
}

export function writeCellRun(
  sessionId: string,
  artifactId: string,
  cellId: string,
  run: ComputeProRun,
  status: ComputeProPayload['status'],
  provenancePatch?: ComputeCellProvenance,
  /** When true this is the terminal finished-run write (not a loading
   *  stub). Successful finishes bump executionCount so the header can
   *  show a Jupyter-style `In [N]`. */
  finished?: { success: boolean },
): void {
  const s = useRuntimeStore.getState()
  const a = s.sessions[sessionId]?.artifacts[artifactId]
  if (!a || a.kind !== 'compute-pro') return
  const payload = (a as ComputeProArtifact).payload
  const nextCells = payload.cells.map((c) => {
    if (c.id !== cellId) return c
    const next: typeof c = { ...c, lastRun: run, updatedAt: Date.now() }
    if (provenancePatch) {
      next.provenance = { ...(c.provenance ?? {}), ...provenancePatch }
    }
    if (finished?.success) {
      next.executionCount = (c.executionCount ?? 0) + 1
    }
    return next
  })
  s.patchArtifact(sessionId, artifactId, {
    payload: { ...payload, cells: nextCells, status },
  })
}

/**
 * Wipe a stub run when execution throws before producing a real result.
 * We don't replace `cell.lastRun` with an error stub — the previous real
 * run (if any) is more useful to keep on screen.
 */
export function clearCellStub(
  sessionId: string,
  artifactId: string,
  cellId: string,
  stubRunId: string,
  errorMessage: string,
): void {
  const s = useRuntimeStore.getState()
  const a = s.sessions[sessionId]?.artifacts[artifactId]
  if (!a || a.kind !== 'compute-pro') return
  const payload = (a as ComputeProArtifact).payload
  const nextCells = payload.cells.map((c) => {
    if (c.id !== cellId) return c
    if (c.lastRun?.id === stubRunId) {
      return { ...c, lastRun: null, updatedAt: Date.now() }
    }
    return c
  })
  s.patchArtifact(sessionId, artifactId, {
    payload: {
      ...payload,
      cells: nextCells,
      status: 'error',
      lastError: errorMessage,
    },
  })
}
