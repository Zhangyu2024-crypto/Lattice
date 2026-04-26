// `compute_run` — execute an existing compute artifact's script/input deck.
//
// This is a thin async adapter around `runCompute` (src/lib/compute-run.ts),
// which owns all of the IPC / streaming / payload-patching machinery for
// compute runs. Our job here is:
//   1. validate the artifactId actually points at a compute artifact,
//   2. kick off `runCompute` with the stored code,
//   3. wait briefly for the run to finish, or return immediately when
//      the caller requested background mode; long scientific jobs should
//      keep running in the artifact instead of blocking the agent loop,
//   4. report the tail of stdout + figure count so the agent's next turn
//      has a useful summary without having to GET the full artifact.
//
// The poll-based wait is intentional: wiring a callback through
// `runCompute` would require plumbing that doesn't exist yet, and the
// session store is already the source of truth for run status. We check
// ~10x/second and honour `ctx.signal` for cooperative cancellation.

import type {
  ComputeArtifact,
  ComputeArtifactPayload,
  ComputeStatus,
} from '../../types/artifact'
import type { LocalTool } from '../../types/agent-tool'
import { isComputeArtifact } from '../../types/artifact'
import { runCompute } from '../compute-run'
import { useRuntimeStore } from '../../stores/runtime-store'
import { createStructureFromCif } from '../structure-builder'

interface Input {
  artifactId: string
  /** Wall-clock timeout for the spawned process. This is not the agent's
   *  wait budget when `waitTimeoutMs` is provided. */
  timeoutMs?: number
  /** When false, start the process and return as soon as the run is
   *  accepted. Use for DFT/NEB/phonon/production MD jobs. */
  waitForCompletion?: boolean
  /** How long the agent should wait before returning `status: running`.
   *  The process itself keeps running until `timeoutMs`, Stop, or exit. */
  waitTimeoutMs?: number
}

interface Output {
  artifactId: string
  runId?: string
  /** First-class run status. The agent MUST check this before
   *  synthesising any numeric / derived result; anything other than
   *  'succeeded' means the run did not produce a trustworthy output. */
  status: ComputeStatus
  /** Convenience flag that mirrors `status === 'cancelled'`. Exposed
   *  as its own field so models that glance at boolean flags but skim
   *  string statuses catch the failure case. */
  cancelled: boolean
  /** True when the run was killed by the configured timeout rather than
   *  an explicit Stop action. Timed-out runs are reported as failed. */
  timedOut: boolean
  /** True when the tool returned before process exit. The artifact card
   *  remains the live source of stdout/stderr/progress. */
  background: boolean
  /** True when `waitForCompletion` was true but `waitTimeoutMs` elapsed
   *  while the process was still running. */
  waitTimedOut: boolean
  exitCode: number | null
  /** Duration of the last run in milliseconds. 0 when the artifact
   *  was never run in this session. */
  durationMs: number
  /** Absolute path to the archived workdir (see workspace/compute/...
   *  per-run archive). Present when archival succeeded; absent on
   *  programmatic callers that skipped the sessionId/artifactId
   *  wiring. */
  workdir?: string
  stdoutTail: string
  figureCount: number
  structureArtifactId?: string
  /** Single-sentence human summary. When the run was cancelled or
   *  failed, the summary starts with a capitalised status word and
   *  includes the token-level anchor "Do NOT present derived
   *  results" so prompt-side rules can trip on it. */
  summary: string
}

const MAX_TIMEOUT_MS = 24 * 60 * 60_000
const DEFAULT_TIMEOUT_MS = 30 * 60_000
const DEFAULT_BACKGROUND_TIMEOUT_MS = MAX_TIMEOUT_MS
const DEFAULT_WAIT_TIMEOUT_MS = 2 * 60_000
const POLL_INTERVAL_MS = 100
const STDOUT_TAIL_CHARS = 1200

export const computeRunTool: LocalTool<Input, Output> = {
  name: 'compute_run',
  description:
    "Execute an existing compute artifact's stored script or native input deck. Supports Python, LAMMPS, CP2K, and shell according to the artifact language. Use this after compute_create_script / compute_edit_script / compute_from_snippet / simulate_structure / export_for_engine when the user wants to actually run the code. For long materials jobs such as DFT geometry optimization, NEB, phonons, or production MD, set waitForCompletion=false so the run continues in the background and the agent can report status without waiting for final results. The returned stdoutTail is the last slice of stdout so you can summarise results without re-fetching the whole artifact.",
  trustLevel: 'hostExec',
  cardMode: 'info',
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: {
        type: 'string',
        description:
          'The compute artifact to execute. Must be a `compute` kind artifact — usually one created by compute_create_script, compute_from_snippet, simulate_structure, export_for_engine, or opened via the "Open in Code" button.',
      },
      timeoutMs: {
        type: 'number',
        description: `Optional process wall-clock timeout in ms. Capped at ${MAX_TIMEOUT_MS}. Defaults to ${DEFAULT_TIMEOUT_MS} when waiting and ${DEFAULT_BACKGROUND_TIMEOUT_MS} in background mode.`,
      },
      waitForCompletion: {
        type: 'boolean',
        description:
          'Whether the agent should wait for the process to finish. Default true, but only up to waitTimeoutMs. Set false for long DFT/NEB/phonon/production MD jobs.',
      },
      waitTimeoutMs: {
        type: 'number',
        description: `Optional agent wait budget in ms before returning status=running. Default ${DEFAULT_WAIT_TIMEOUT_MS}. The process keeps running until timeoutMs or Stop.`,
      },
    },
    required: ['artifactId'],
  },

  async execute(input, ctx) {
    if (ctx.signal.aborted) throw new Error('Aborted before start')

    const artifactId =
      typeof input?.artifactId === 'string' ? input.artifactId.trim() : ''
    if (!artifactId) throw new Error('artifactId is required')
    const waitForCompletion = input?.waitForCompletion !== false
    const timeoutMs = normaliseMs(
      typeof input?.timeoutMs === 'number' && Number.isFinite(input.timeoutMs)
        ? input.timeoutMs
        : waitForCompletion
          ? DEFAULT_TIMEOUT_MS
          : DEFAULT_BACKGROUND_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    )
    const waitTimeoutMs = waitForCompletion
      ? normaliseMs(
          typeof input?.waitTimeoutMs === 'number' && Number.isFinite(input.waitTimeoutMs)
            ? input.waitTimeoutMs
            : DEFAULT_WAIT_TIMEOUT_MS,
          Math.min(MAX_TIMEOUT_MS, timeoutMs),
        )
      : 0

    const initial = readComputeArtifact(ctx.sessionId, artifactId)

    const ack = await runCompute({
      sessionId: ctx.sessionId,
      artifactId,
      code: initial.payload.code,
      timeoutSec: Math.ceil(timeoutMs / 1000),
    })
    if (!ack.success) {
      throw new Error(ack.error ?? 'compute run rejected')
    }

    const waited = waitForCompletion
      ? await waitForRunCompletion(
          ctx.sessionId,
          artifactId,
          waitTimeoutMs,
          ctx.signal,
        )
      : {
          artifact: readComputeArtifact(ctx.sessionId, artifactId),
          waitTimedOut: true,
        }
    const final = waited.artifact

    const stdout = final.payload.stdout ?? ''
    const stdoutTail = tail(stdout, STDOUT_TAIL_CHARS)
    const figureCount = final.payload.figures.length
    const status = final.payload.status
    const exitCode = final.payload.exitCode
    const durationMs = latestDurationMs(final.payload)
    // Latest archived run carries the workdir; prior runs still exist in
    // history but only the newest matches this tool invocation.
    const workdir = ack.workdir ?? final.payload.runs?.[0]?.workdir

    // Structure-from-CIF heuristic: only attempt when the run actually
    // succeeded. Previously we checked exitCode === 0 which misses the
    // subtlety that a cancelled run can have exitCode null; be strict.
    let structureArtifactId: string | undefined
    if (status === 'succeeded' && looksLikeCif(stdout)) {
      try {
        const result = await createStructureFromCif({
          sessionId: ctx.sessionId,
          cif: stdout.trim(),
          titleMode: 'formula',
          transformKind: 'import',
          transformParams: { source: 'compute_run', computeArtifactId: artifactId },
          transformNote: `Generated by compute script ${initial.title}`,
          orchestrator: null,
        })
        structureArtifactId = result.artifact.id
      } catch {
        // CIF parsing failed — not a valid structure, skip silently
      }
    }

    return {
      artifactId,
      ...(ack.runId ? { runId: ack.runId } : {}),
      status,
      cancelled: status === 'cancelled',
      timedOut: Boolean(final.payload.timedOut),
      background: status === 'running',
      waitTimedOut: waited.waitTimedOut,
      exitCode,
      durationMs,
      ...(workdir ? { workdir } : {}),
      stdoutTail,
      figureCount,
      structureArtifactId,
      summary: buildSummary({
        status,
        exitCode,
        figureCount,
        durationMs,
        timedOut: Boolean(final.payload.timedOut),
      })
        + (structureArtifactId ? ' · structure created' : ''),
    }
  },
}

function readComputeArtifact(
  sessionId: string,
  artifactId: string,
): ComputeArtifact {
  const session = useRuntimeStore.getState().sessions[sessionId]
  if (!session) throw new Error(`Session not found: ${sessionId}`)
  const artifact = session.artifacts[artifactId]
  if (!artifact) throw new Error(`Artifact not found: ${artifactId}`)
  if (!isComputeArtifact(artifact)) {
    throw new Error(
      `Artifact ${artifactId} is kind="${artifact.kind}"; compute_run requires a 'compute' artifact.`,
    )
  }
  if (!artifact.payload.code || artifact.payload.code.trim().length === 0) {
    throw new Error(
      `Compute artifact ${artifactId} has no script to run. Create one with compute_create_script or edit it with compute_edit_script.`,
    )
  }
  return artifact
}

async function waitForRunCompletion(
  sessionId: string,
  artifactId: string,
  waitTimeoutMs: number,
  signal: AbortSignal,
): Promise<{ artifact: ComputeArtifact; waitTimedOut: boolean }> {
  const deadline = Date.now() + waitTimeoutMs
  while (true) {
    if (signal.aborted) throw new Error('Aborted while waiting for compute run')
    const artifact = readComputeArtifact(sessionId, artifactId)
    const status = artifact.payload.status
    if (status !== 'running') return { artifact, waitTimedOut: false }
    if (Date.now() >= deadline) {
      return { artifact, waitTimedOut: true }
    }
    await sleep(POLL_INTERVAL_MS)
  }
}

function normaliseMs(value: number, maxMs: number): number {
  return Math.min(maxMs, Math.max(1000, Math.floor(value)))
}

function latestDurationMs(payload: ComputeArtifactPayload): number {
  if (typeof payload.durationMs === 'number') return payload.durationMs
  if (payload.status === 'running') {
    const startedAt = payload.runs?.[0]?.startedAt
    if (startedAt) {
      const t = new Date(startedAt).getTime()
      if (Number.isFinite(t)) return Math.max(0, Date.now() - t)
    }
  }
  return 0
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function tail(text: string, maxChars: number): string {
  if (!text) return ''
  if (text.length <= maxChars) return text
  return `…[truncated]\n${text.slice(-maxChars)}`
}

/** Build the tool-result summary string. For non-succeeded runs the
 *  summary starts with a capitalised status word and carries the exact
 *  token "Do NOT present derived results" — L2 (orchestrator warning
 *  envelope) and L3 (system prompt rule) both anchor on that phrase, so
 *  any regression that drops it from the summary should fail tests.
 *
 *  Exported ONLY for the co-located unit test. No other module should
 *  import it — it's an internal formatting helper.
 */
export const INTEGRITY_ANCHOR = 'Do NOT present derived results'

export function buildSummary(args: {
  status: ComputeArtifactPayload['status']
  exitCode: number | null
  figureCount: number
  durationMs?: number
  timedOut?: boolean
}): string {
  const duration =
    typeof args.durationMs === 'number' ? ` in ${formatMs(args.durationMs)}` : ''
  const figures =
    args.figureCount > 0
      ? `, ${args.figureCount} figure${args.figureCount === 1 ? '' : 's'}`
      : ''
  const exit = args.exitCode !== null ? ` (exit=${args.exitCode})` : ''

  if (args.timedOut) {
    return `TIMED OUT${duration} — run did not complete${exit}. ${INTEGRITY_ANCHOR}.`
  }
  if (args.status === 'cancelled') {
    return (
      `CANCELLED${duration} — run did not complete${exit}. ${INTEGRITY_ANCHOR}.`
    )
  }
  if (args.status === 'failed') {
    return `FAILED${exit}${duration}. ${INTEGRITY_ANCHOR}.`
  }
  if (args.status === 'succeeded') {
    return `Succeeded${exit}${duration}${figures}.`
  }
  if (args.status === 'running') {
    return `RUNNING${duration} — compute process is still in progress. ${INTEGRITY_ANCHOR} until status=succeeded.`
  }
  // idle / running / unknown — should not normally reach here since
  // waitForRunCompletion blocks until status !== 'running', but be
  // defensive.
  return `Compute run ${args.status}${exit}${duration}${figures}.`
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`
  const m = Math.floor(ms / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return `${m}m ${s}s`
}

function looksLikeCif(text: string): boolean {
  if (!text || text.length < 50) return false
  return /^data_/m.test(text) && /_cell_length_a/m.test(text)
}
