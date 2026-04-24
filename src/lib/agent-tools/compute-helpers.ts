import type { ComputeArtifact, StructureArtifact } from '../../types/artifact'
import { isComputeArtifact, isStructureArtifact } from '../../types/artifact'
import type { ComputeLanguage } from '../../types/pro-api'
import {
  genArtifactId,
  useRuntimeStore,
} from '../../stores/runtime-store'
import { localProCompute, slugForCifKey } from '../local-pro-compute'
import { runCompute } from '../compute-run'

export function resolveStructureArtifact(
  sessionId: string,
  artifactId?: string,
): StructureArtifact {
  const session = useRuntimeStore.getState().sessions[sessionId]
  if (!session) throw new Error(`Session not found: ${sessionId}`)

  if (artifactId) {
    const a = session.artifacts[artifactId]
    if (!a) throw new Error(`Artifact ${artifactId} not found`)
    if (!isStructureArtifact(a)) {
      throw new Error(`Artifact ${artifactId} is kind="${a.kind}", expected structure.`)
    }
    return a
  }

  const focused = session.focusedArtifactId
    ? session.artifacts[session.focusedArtifactId]
    : null
  if (focused && isStructureArtifact(focused)) return focused

  const structs = Object.values(session.artifacts).filter(isStructureArtifact)
  if (structs.length === 1) return structs[0]
  if (structs.length === 0) {
    throw new Error('No structure artifact in session. Build or import one first.')
  }
  throw new Error(
    `${structs.length} structure artifacts in session — pass artifactId to pick one.`,
  )
}

export function structureSlug(artifact: StructureArtifact): string {
  const formula =
    (artifact.payload as { formula?: string }).formula ?? ''
  return slugForCifKey(artifact.title || formula || artifact.id)
}

export async function ensureComputeReady(): Promise<void> {
  const health = await localProCompute.computeHealth()
  if (!health.container_up) {
    throw new Error(
      `Compute environment is not ready${health.error ? `: ${health.error}` : ''}. Check that the bundled conda environment is intact, or re-run the installer.`,
    )
  }
}

export function createComputeArtifact(
  sessionId: string,
  opts: {
    title: string
    code: string
    language?: ComputeLanguage
  },
): ComputeArtifact {
  const now = Date.now()
  const artifact: ComputeArtifact = {
    id: genArtifactId(),
    kind: 'compute',
    title: opts.title,
    createdAt: now,
    updatedAt: now,
    payload: {
      language: opts.language ?? 'python',
      code: opts.code,
      stdout: '',
      stderr: '',
      figures: [],
      exitCode: null,
      status: 'idle',
    },
  }
  const store = useRuntimeStore.getState()
  store.upsertArtifact(sessionId, artifact)
  store.focusArtifact(sessionId, artifact.id)
  return artifact
}

const POLL_MS = 100
const DEFAULT_TIMEOUT_MS = 5 * 60_000
const STDOUT_TAIL = 1200

export async function runAndWait(
  sessionId: string,
  artifactId: string,
  signal: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ exitCode: number | null; stdoutTail: string; figureCount: number }> {
  const session = useRuntimeStore.getState().sessions[sessionId]
  const art = session?.artifacts[artifactId]
  if (!art || !isComputeArtifact(art)) throw new Error('Compute artifact not found')

  const ack = await runCompute({
    sessionId,
    artifactId,
    code: art.payload.code,
  })
  if (!ack.success) throw new Error(ack.error ?? 'compute run rejected')

  const deadline = Date.now() + timeoutMs
  while (true) {
    if (signal.aborted) throw new Error('Aborted')
    const cur = useRuntimeStore.getState().sessions[sessionId]?.artifacts[artifactId]
    if (cur && isComputeArtifact(cur) && cur.payload.status !== 'running') {
      const stdout = cur.payload.stdout ?? ''
      return {
        exitCode: cur.payload.exitCode,
        stdoutTail:
          stdout.length <= STDOUT_TAIL
            ? stdout
            : `…[truncated]\n${stdout.slice(-STDOUT_TAIL)}`,
        figureCount: cur.payload.figures.length,
      }
    }
    if (Date.now() >= deadline) throw new Error(`Timeout after ${timeoutMs}ms`)
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
}
