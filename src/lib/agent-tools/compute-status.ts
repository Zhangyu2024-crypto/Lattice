// `compute_status` — report the current run state of a compute (or
// compute-experiment) artifact.
//
// Surfaces the fields the model usually wants between iterations of a
// long script: status, exit code, duration, the tail of stdout/stderr,
// and the last run-history entry. Does not stream — the model polls
// this between turns.

import type { LocalTool } from '../../types/agent-tool'
import { useRuntimeStore } from '../../stores/runtime-store'
import type {
  ComputeArtifactPayload,
  ComputeExperimentPayload,
  ComputeRunEntry,
  ComputeStatus,
} from '../../types/artifact'

const TAIL_BYTES = 4_000

interface Input {
  artifactId: string
  /** Number of stdout/stderr characters to return from the tail.
   *  Defaults to 4000, capped at 16000. */
  tailBytes?: number
}

interface Output {
  ok: true
  artifactId: string
  kind: 'compute' | 'compute-experiment' | 'unknown'
  status: ComputeStatus | string
  running: boolean
  exitCode: number | null
  durationMs?: number
  timedOut?: boolean
  progress?: { current: number; total: number }
  stdoutTail: string
  stderrTail: string
  lastRun?: ComputeRunEntry
  /** Only present for compute-experiment artifacts. */
  pointsTotal?: number
  pointsDone?: number
  pointsFailed?: number
}

function tail(s: string, n: number): string {
  if (!s) return ''
  return s.length <= n ? s : s.slice(-n)
}

export const computeStatusTool: LocalTool<Input, Output> = {
  name: 'compute_status',
  description:
    "Report the current run state of a compute artifact: status, exit code, duration, tail of stdout/stderr, last run-history entry. For compute-experiment artifacts, also returns per-point counts. Cheap; safe to poll between iterations of a long script.",
  cardMode: 'silent',
  contextParams: ['artifactId'],
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: {
        type: 'string',
        description: 'Artifact id (compute or compute-experiment).',
      },
      tailBytes: {
        type: 'number',
        description: 'Stdout/stderr tail length in chars. Default 4000, max 16000.',
      },
    },
    required: ['artifactId'],
  },
  async execute(input, ctx) {
    if (!input?.artifactId) throw new Error('artifactId is required')
    const tailLen = Math.min(
      Math.max(0, input.tailBytes ?? TAIL_BYTES),
      16_000,
    )
    const rt = useRuntimeStore.getState()
    // Search the active session first, then fall back to a sweep —
    // artifacts can technically live in any session.
    const sessions = ctx.sessionId
      ? [rt.sessions[ctx.sessionId], ...Object.values(rt.sessions)]
      : Object.values(rt.sessions)
    let artifact: { kind: string; payload: unknown } | undefined
    for (const ses of sessions) {
      if (!ses) continue
      const found = ses.artifacts[input.artifactId]
      if (found) {
        artifact = found
        break
      }
    }
    if (!artifact) {
      throw new Error(`Artifact not found: ${input.artifactId}`)
    }

    if (artifact.kind === 'compute') {
      const p = artifact.payload as ComputeArtifactPayload
      const lastRun = p.runs?.[0]
      return {
        ok: true,
        artifactId: input.artifactId,
        kind: 'compute',
        status: p.status,
        running: p.status === 'running',
        exitCode: p.exitCode ?? null,
        durationMs: p.durationMs,
        timedOut: p.timedOut,
        progress: p.progress,
        stdoutTail: tail(p.stdout ?? '', tailLen),
        stderrTail: tail(p.stderr ?? '', tailLen),
        lastRun,
      }
    }

    if (artifact.kind === 'compute-experiment') {
      const p = artifact.payload as ComputeExperimentPayload
      const points = p.points ?? []
      const done = points.filter((pt) => pt.status === 'succeeded').length
      const failed = points.filter((pt) => pt.status === 'failed').length
      return {
        ok: true,
        artifactId: input.artifactId,
        kind: 'compute-experiment',
        status: p.status,
        running: p.status === 'running',
        exitCode: null,
        progress: p.progress,
        stdoutTail: tail(p.stdout ?? '', tailLen),
        stderrTail: tail(p.stderr ?? '', tailLen),
        pointsTotal: points.length,
        pointsDone: done,
        pointsFailed: failed,
      }
    }

    return {
      ok: true,
      artifactId: input.artifactId,
      kind: 'unknown',
      status: 'unknown',
      running: false,
      exitCode: null,
      stdoutTail: '',
      stderrTail: '',
    }
  },
}
