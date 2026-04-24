// `compute_run` — execute an existing compute artifact's script.
//
// This is a thin async adapter around `runCompute` (src/lib/compute-run.ts),
// which owns all of the IPC / streaming / payload-patching machinery for
// compute runs. Our job here is:
//   1. validate the artifactId actually points at a compute artifact,
//   2. kick off `runCompute` with the stored code,
//   3. wait for the run to finish — `runCompute` itself returns only the
//      IPC acknowledgement, so we poll the session store until status
//      transitions away from 'running',
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
  /** Optional override (ms). Hard-capped so a runaway model can't stall
   *  the agent loop indefinitely. */
  timeoutMs?: number
}

interface Output {
  artifactId: string
  /** First-class run status. The agent MUST check this before
   *  synthesising any numeric / derived result; anything other than
   *  'succeeded' means the run did not produce a trustworthy output. */
  status: ComputeStatus
  /** Convenience flag that mirrors `status === 'cancelled'`. Exposed
   *  as its own field so models that glance at boolean flags but skim
   *  string statuses catch the failure case. */
  cancelled: boolean
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

const DEFAULT_TIMEOUT_MS = 5 * 60_000
const MAX_TIMEOUT_MS = 30 * 60_000
const POLL_INTERVAL_MS = 100
const STDOUT_TAIL_CHARS = 1200

export const computeRunTool: LocalTool<Input, Output> = {
  name: 'compute_run',
  description:
    "Execute an existing compute artifact's stored script and wait for completion. The tool returns only after the run exits (or times out). Use this after compute_create_script / compute_edit_script when the user wants to actually run the code. The returned stdoutTail is the last slice of stdout so you can summarise results without re-fetching the whole artifact.",
  trustLevel: 'hostExec',
  cardMode: 'review',
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: {
        type: 'string',
        description:
          'The compute artifact to execute. Must be a `compute` kind artifact — usually one created by compute_create_script or opened via the "Open in Code" button.',
      },
      timeoutMs: {
        type: 'number',
        description: `Optional wait timeout in ms. Capped at ${MAX_TIMEOUT_MS}. Default ${DEFAULT_TIMEOUT_MS}.`,
      },
    },
    required: ['artifactId'],
  },

  async execute(input, ctx) {
    if (ctx.signal.aborted) throw new Error('Aborted before start')

    const artifactId =
      typeof input?.artifactId === 'string' ? input.artifactId.trim() : ''
    if (!artifactId) throw new Error('artifactId is required')
    const timeoutMs = Math.min(
      MAX_TIMEOUT_MS,
      Math.max(
        1000,
        typeof input?.timeoutMs === 'number' && Number.isFinite(input.timeoutMs)
          ? Math.floor(input.timeoutMs)
          : DEFAULT_TIMEOUT_MS,
      ),
    )

    const initial = readComputeArtifact(ctx.sessionId, artifactId)

    const ack = await runCompute({
      sessionId: ctx.sessionId,
      artifactId,
      code: initial.payload.code,
    })
    if (!ack.success) {
      throw new Error(ack.error ?? 'compute run rejected')
    }

    const final = await waitForRunCompletion(
      ctx.sessionId,
      artifactId,
      timeoutMs,
      ctx.signal,
    )

    const stdout = final.payload.stdout ?? ''
    const stdoutTail = tail(stdout, STDOUT_TAIL_CHARS)
    const figureCount = final.payload.figures.length
    const status = final.payload.status
    const exitCode = final.payload.exitCode
    const durationMs = final.payload.durationMs ?? 0
    // Latest archived run carries the workdir; prior runs still exist in
    // history but only the newest matches this tool invocation.
    const workdir = final.payload.runs?.[0]?.workdir

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
      status,
      cancelled: status === 'cancelled',
      exitCode,
      durationMs,
      ...(workdir ? { workdir } : {}),
      stdoutTail,
      figureCount,
      structureArtifactId,
      summary: buildSummary({ status, exitCode, figureCount, durationMs })
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
  timeoutMs: number,
  signal: AbortSignal,
): Promise<ComputeArtifact> {
  const deadline = Date.now() + timeoutMs
  while (true) {
    if (signal.aborted) throw new Error('Aborted while waiting for compute run')
    const artifact = readComputeArtifact(sessionId, artifactId)
    const status = artifact.payload.status
    if (status !== 'running') return artifact
    if (Date.now() >= deadline) {
      throw new Error(
        `compute_run exceeded timeout (${timeoutMs} ms) while status=running. The run is still executing in the background; inspect the artifact to check progress.`,
      )
    }
    await sleep(POLL_INTERVAL_MS)
  }
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
}): string {
  const duration =
    typeof args.durationMs === 'number' ? ` in ${formatMs(args.durationMs)}` : ''
  const figures =
    args.figureCount > 0
      ? `, ${args.figureCount} figure${args.figureCount === 1 ? '' : 's'}`
      : ''
  const exit = args.exitCode !== null ? ` (exit=${args.exitCode})` : ''

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
