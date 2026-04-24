// Local batch runner — processes a BatchWorkflowArtifact serially in the
// renderer, mutating its payload step-by-step and broadcasting structured
// `task_start | tool_invocation | tool_result | task_end` events on
// `wsClient` so the TaskTimeline renders live progress.
//
// Self-contained Port Plan §P2: the scheduler itself stays in the
// renderer; per-file work is delegated to a pluggable BatchExecutor, which
// lets future executors invoke the compute IPC (docker runner) or pure
// local transforms without changing the scheduler.
//
// Cancellation: each run owns an AbortController; cancel() aborts the in-
// flight executor and marks any remaining files as still-pending with a
// cancellation note. The runner itself does not retry — a resume is just
// another call with `onlyPending: true`.

import { useRuntimeStore } from '../stores/runtime-store'
import { wsClient } from '../stores/ws-client'
import type { BatchFile, BatchWorkflowPayload } from '../types/artifact'

export interface BatchExecutorContext {
  sessionId: string
  artifactId: string
  file: BatchFile
  fileIndex: number
  signal: AbortSignal
}

export interface BatchExecutorResult {
  durationMs?: number
  /** Optional artifact ids produced by this file; used to wire the
   *  "focus linked artifact" row-click affordance in BatchWorkflowCard. */
  artifactIds?: string[]
}

export type BatchExecutor = (
  ctx: BatchExecutorContext,
) => Promise<BatchExecutorResult>

export interface RunBatchOptions {
  sessionId: string
  artifactId: string
  executor: BatchExecutor
  /** When true only files whose status is not already 'succeeded' are
   *  processed (used for resume). Defaults to false (process all). */
  onlyPending?: boolean
}

export interface BatchRunHandle {
  taskId: string
  promise: Promise<void>
  cancel: (reason?: string) => void
}

// One in-flight run per artifact; a second start attempt returns the same
// handle to avoid two schedulers fighting over the same payload.
const activeByArtifact = new Map<string, BatchRunHandle>()

function genTaskId(): string {
  return `batch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

function genStepId(index: number): string {
  return `batch_step_${index.toString(36)}`
}

/** Returns a shallow-cloned `BatchWorkflowPayload` with the given file at
 *  `index` replaced. Caller is responsible for passing the mutation to
 *  `patchArtifact`. */
function replaceFile(
  payload: BatchWorkflowPayload,
  index: number,
  patch: Partial<BatchFile>,
): BatchWorkflowPayload {
  const files = payload.files.slice()
  files[index] = { ...files[index], ...patch }
  return { ...payload, files }
}

/** Recompute the summary counters from the current file list. */
function summarize(
  payload: BatchWorkflowPayload,
  startedAt: number,
  endedAt: number | undefined,
): BatchWorkflowPayload['summary'] {
  const ok = payload.files.filter((f) => f.status === 'succeeded').length
  const failed = payload.files.filter((f) => f.status === 'failed').length
  return {
    total: payload.files.length,
    ok,
    failed,
    jsonlUrl: payload.summary?.jsonlUrl,
    startedAt,
    endedAt,
  }
}

function readPayload(
  sessionId: string,
  artifactId: string,
): BatchWorkflowPayload | null {
  const session = useRuntimeStore.getState().sessions[sessionId]
  const artifact = session?.artifacts[artifactId]
  if (!artifact || artifact.kind !== 'batch') return null
  return artifact.payload as BatchWorkflowPayload
}

export function isBatchRunActive(artifactId: string): boolean {
  return activeByArtifact.has(artifactId)
}

export function runBatch(opts: RunBatchOptions): BatchRunHandle {
  const { sessionId, artifactId, executor, onlyPending = false } = opts
  const existing = activeByArtifact.get(artifactId)
  if (existing) return existing

  const controller = new AbortController()
  const taskId = genTaskId()

  const promise = (async () => {
    const startPayload = readPayload(sessionId, artifactId)
    if (!startPayload) return
    const startedAt = Date.now()

    // ── task_start event + mark artifact running ──────────────────
    wsClient.dispatch('task_start', {
      task_id: taskId,
      session_id: sessionId,
      title: `Batch: ${startPayload.pipeline.join(' → ') || 'run'}`,
    })
    useRuntimeStore.getState().patchArtifact(sessionId, artifactId, {
      payload: {
        ...startPayload,
        status: 'running',
        summary: summarize(startPayload, startedAt, undefined),
      },
    })

    const indices = startPayload.files
      .map((file, index) => ({ file, index }))
      .filter(({ file }) => !onlyPending || file.status !== 'succeeded')
      .map(({ index }) => index)

    for (const index of indices) {
      if (controller.signal.aborted) break

      // Re-read the payload at each step so executor-driven mutations
      // (e.g. artifactIds appended on a previous file) survive here.
      const liveBefore = readPayload(sessionId, artifactId)
      if (!liveBefore) break
      const file = liveBefore.files[index]
      if (!file) continue

      const stepId = genStepId(index)

      // ── tool_invocation + mark file running ───────────────────────
      wsClient.dispatch('tool_invocation', {
        task_id: taskId,
        step_id: stepId,
        session_id: sessionId,
        tool_name: liveBefore.pipeline[0] ?? 'batch-item',
        input_summary: file.relPath,
      })
      useRuntimeStore.getState().patchArtifact(sessionId, artifactId, {
        payload: replaceFile(liveBefore, index, {
          status: 'running',
          errorMessage: undefined,
        }),
      })

      // ── Executor (try/catch separately so one failure doesn't abort) ──
      const itemStarted = Date.now()
      let result: BatchExecutorResult | null = null
      let errorMessage: string | null = null

      try {
        result = await executor({
          sessionId,
          artifactId,
          file,
          fileIndex: index,
          signal: controller.signal,
        })
      } catch (err) {
        if (controller.signal.aborted) {
          // Cancellation: stop the loop, leave this file as-is for resume.
          break
        }
        errorMessage = err instanceof Error ? err.message : String(err)
      }

      const finishedAt = Date.now()
      const duration = result?.durationMs ?? finishedAt - itemStarted
      const liveAfter = readPayload(sessionId, artifactId)
      if (!liveAfter) break

      const succeeded = errorMessage === null

      // ── tool_result + mutate file to succeeded|failed ─────────────
      wsClient.dispatch('tool_result', {
        task_id: taskId,
        step_id: stepId,
        session_id: sessionId,
        tool_name: liveAfter.pipeline[0] ?? 'batch-item',
        status: succeeded ? 'succeeded' : 'failed',
        output_summary: succeeded
          ? `Completed in ${duration}ms`
          : errorMessage,
        artifact_ids: result?.artifactIds ?? [],
      })
      const patched = replaceFile(liveAfter, index, {
        status: succeeded ? 'succeeded' : 'failed',
        durationMs: duration,
        errorMessage: succeeded ? undefined : (errorMessage ?? undefined),
        artifactIds: succeeded
          ? [...(liveAfter.files[index].artifactIds ?? []), ...(result?.artifactIds ?? [])]
          : liveAfter.files[index].artifactIds,
      })
      useRuntimeStore.getState().patchArtifact(sessionId, artifactId, {
        payload: {
          ...patched,
          summary: summarize(patched, startedAt, undefined),
        },
      })
    }

    // ── finalise ──────────────────────────────────────────────────
    const endedAt = Date.now()
    const finalPayload = readPayload(sessionId, artifactId)
    if (!finalPayload) return

    const stillRunning = finalPayload.files.some((f) => f.status === 'running')
    // Any file left running was interrupted by cancel — roll it back to
    // pending so a Resume starts clean.
    const sanitizedFiles = stillRunning
      ? finalPayload.files.map((f) =>
          f.status === 'running'
            ? { ...f, status: 'pending' as const, errorMessage: 'Cancelled' }
            : f,
        )
      : finalPayload.files
    const cancelled = controller.signal.aborted
    const hasFailures = sanitizedFiles.some((f) => f.status === 'failed')
    const finalStatus: BatchWorkflowPayload['status'] = cancelled
      ? 'idle'
      : hasFailures
        ? 'failed'
        : 'succeeded'
    const finalSummary = summarize(
      { ...finalPayload, files: sanitizedFiles },
      startedAt,
      endedAt,
    )
    useRuntimeStore.getState().patchArtifact(sessionId, artifactId, {
      payload: {
        ...finalPayload,
        files: sanitizedFiles,
        status: finalStatus,
        summary: finalSummary,
      },
    })

    wsClient.dispatch('task_end', {
      task_id: taskId,
      session_id: sessionId,
      status: cancelled
        ? 'cancelled'
        : hasFailures
          ? 'failed'
          : 'succeeded',
    })
  })()
    .catch((err) => {
      // Scheduler itself should never throw — if it does, log and mark
      // failed so the UI doesn't get stuck in 'running'.
      // eslint-disable-next-line no-console
      console.error('[batch-runner] scheduler failed:', err)
      const payload = readPayload(sessionId, artifactId)
      if (payload) {
        useRuntimeStore.getState().patchArtifact(sessionId, artifactId, {
          payload: { ...payload, status: 'failed' },
        })
      }
      wsClient.dispatch('task_end', {
        task_id: taskId,
        session_id: sessionId,
        status: 'failed',
      })
    })
    .finally(() => {
      activeByArtifact.delete(artifactId)
    })

  const handle: BatchRunHandle = {
    taskId,
    promise,
    cancel: (_reason = 'Cancelled by user') => {
      if (!controller.signal.aborted) controller.abort()
    },
  }
  activeByArtifact.set(artifactId, handle)
  return handle
}

export function cancelBatch(artifactId: string, reason?: string): boolean {
  const handle = activeByArtifact.get(artifactId)
  if (!handle) return false
  handle.cancel(reason)
  return true
}
