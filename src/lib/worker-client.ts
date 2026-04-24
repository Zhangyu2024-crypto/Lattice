// Renderer-side wrapper around the Electron `worker:*` IPC.
//
// Self-contained Port Plan §P4-α — the worker is the channel through
// which scientific Python tools (XRD search, XPS fit, paper extraction,
// ...) will be invoked from the renderer. P4-α only ships the plumbing
// + two tools (`system.echo`, `library.fetch_doi`); future phases add
// real algorithms behind the same `callWorker(method, params)` shape.

import type {
  WorkerCallResultPayload,
  WorkerEventPayload,
  WorkerStatusPayload,
} from '../types/electron'
import { logWorkerFailure } from './logger'

const WORKER_UNAVAILABLE_ERROR =
  'Python worker IPC unavailable — restart the Electron desktop shell to enable Python-backed tools.'

function api() {
  return window.electronAPI
}

/** Lazily start (or reuse) the worker. Resolves once the worker has
 *  signalled `ready`; rejects with the spawn / handshake error if the
 *  Python interpreter or the script can't be reached. */
export async function startWorker(): Promise<WorkerStatusPayload> {
  const electron = api()
  if (!electron?.workerStart) {
    return {
      state: 'failed',
      error: 'Worker IPC unavailable (run inside the Electron shell).',
    }
  }
  const result = await electron.workerStart()
  return result.status
}

export async function getWorkerStatus(): Promise<WorkerStatusPayload> {
  const electron = api()
  if (!electron?.workerStatus) {
    return {
      state: 'failed',
      error: 'Worker IPC unavailable',
    }
  }
  return await electron.workerStatus()
}

/** Invoke a worker tool. The worker auto-starts on the first call so
 *  callers don't need to remember to `startWorker()` first; callers
 *  that *want* to keep the worker hot ahead of time should still call
 *  `startWorker()` to pre-pay the spawn cost. */
export async function callWorker<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  options?: { timeoutMs?: number },
): Promise<{ ok: true; value: T; durationMs: number } | { ok: false; error: string; durationMs: number; code?: string }> {
  const electron = api()
  if (!electron?.workerCall) {
    logWorkerFailure(method, {
      ok: false,
      error: WORKER_UNAVAILABLE_ERROR,
      code: 'IPC_UNAVAILABLE',
      duration_ms: 0,
    })
    return { ok: false, error: WORKER_UNAVAILABLE_ERROR, durationMs: 0 }
  }
  const result = await electron.workerCall({
    method,
    params,
    ...(options?.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  })
  if (result.success) {
    return { ok: true, value: result.result as T, durationMs: result.durationMs }
  }
  logWorkerFailure(method, {
    ok: false,
    error: result.error,
    code: result.code,
    duration_ms: result.durationMs,
  })
  return {
    ok: false,
    error: result.error,
    durationMs: result.durationMs,
    ...(result.code ? { code: result.code } : {}),
  }
}

/** Subscribe to worker status changes (idle → starting → ready / failed).
 *  Returns an unsubscribe function. */
export function onWorkerStatus(
  callback: (status: WorkerStatusPayload) => void,
): () => void {
  const electron = api()
  if (!electron?.onWorkerStatus) return () => {}
  return electron.onWorkerStatus(callback)
}

/** Subscribe to streaming worker events tied to a specific `requestId`
 *  (e.g. `progress` events from a long-running tool). The subscription
 *  filters out events for other requests so callers can listen scoped
 *  to their own calls. */
export function onWorkerEventForRequest(
  requestId: string,
  callback: (event: WorkerEventPayload) => void,
): () => void {
  const electron = api()
  if (!electron?.onWorkerEvent) return () => {}
  return electron.onWorkerEvent((event) => {
    if (event.id === requestId) callback(event)
  })
}

/** Subscribe to `event: 'log'` events emitted by the Python worker's
 *  tools. The global error-capture module wires this to the log store
 *  on startup; app code generally doesn't need to call this directly. */
export function onWorkerLog(
  callback: (payload: { level: string; message: string }) => void,
): () => void {
  const electron = api()
  if (!electron?.onWorkerEvent) return () => {}
  return electron.onWorkerEvent((event) => {
    const raw = event as unknown as Record<string, unknown>
    if (raw.event !== 'log') return
    const level = typeof raw.level === 'string' ? raw.level : 'info'
    const message = typeof raw.message === 'string' ? raw.message : ''
    callback({ level, message })
  })
}
