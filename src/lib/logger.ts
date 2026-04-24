// Unified logger API for Lattice-app.
//
// Call sites should prefer this over directly reaching into the log
// store. Keeps source/type/detail consistent and centralises
// worker-failure handling and error classification.
//
// Rule of thumb:
//   - If the event should also appear as a toast → call `toast.error`
//     (pass a `ToastMeta` to carry source/type/detail).
//   - If it's silent (background capture, diagnostics) → call
//     `log.error` / `log.warn` here.
// Never do both for the same event: the toast-store already forwards
// to the log store, so a doubled call produces duplicate entries.

import { useLogStore, type LogDetail } from '../stores/log-store'
import {
  classifyError,
  type LogLevel,
  type LogSource,
  type LogType,
} from './log-classifier'
import { errorMessage } from './error-message'

export interface LogArgs {
  source: LogSource
  type?: LogType
  detail?: LogDetail
}

function emit(
  level: LogLevel,
  source: LogSource,
  type: LogType | undefined,
  message: string,
  detail?: LogDetail,
): string {
  return useLogStore.getState().pushEntry({
    level,
    source,
    type: type ?? 'runtime',
    message,
    detail,
  })
}

export const log = {
  error: (message: string, args: LogArgs): string =>
    emit('error', args.source, args.type, message, args.detail),
  warn: (message: string, args: LogArgs): string =>
    emit('warn', args.source, args.type, message, args.detail),
  info: (message: string, args: LogArgs): string =>
    emit('info', args.source, args.type ?? 'unknown', message, args.detail),
  success: (message: string, args: LogArgs): string =>
    emit('success', args.source, args.type ?? 'unknown', message, args.detail),

  /**
   * Log an unknown thrown value. Extracts message, stack, and cause when
   * available; auto-classifies the `type` via `classifyError` unless the
   * caller overrides it. Use this instead of wrapping every try/catch
   * with its own `log.error(errorMessage(err), ...)`.
   */
  exception: (
    err: unknown,
    args: LogArgs & { message?: string },
  ): string => {
    const type = args.type ?? classifyError(err)
    const message = args.message ?? errorMessage(err)
    const stack = err instanceof Error ? err.stack : undefined
    const errCause = err instanceof Error
      ? (err as Error & { cause?: unknown }).cause
      : undefined
    const cause = errCause != null ? String(errCause) : undefined
    const detail: LogDetail = {
      ...(args.detail ?? {}),
    }
    if (stack && !detail.stack) detail.stack = stack
    if (cause && !detail.cause) detail.cause = cause
    // Promote `.code` / `.status` off the error when present.
    if (err && typeof err === 'object') {
      const maybe = err as Record<string, unknown>
      if (typeof maybe.code === 'string' && !detail.code) detail.code = maybe.code
      if (typeof maybe.status === 'number' && !detail.httpStatus) {
        detail.httpStatus = maybe.status
      }
      if (typeof maybe.body === 'string' && !detail.httpBody) {
        detail.httpBody = maybe.body
      }
    }
    return emit('error', args.source, type, message, detail)
  },
}

// ─── Worker failure helper ─────────────────────────────────────────
//
// `src/lib/worker-client.ts::callWorker` surfaces errors either as
// `{ ok: false, error, code }` on the transport envelope or by throwing
// (when the transport itself fails). Both paths funnel into this helper
// so the taxonomy (code → type) is declared once.

export interface WorkerFailureShape {
  ok: false
  error?: string
  code?: string
  traceback?: string
  duration_ms?: number
}

export function logWorkerFailure(
  method: string,
  result: WorkerFailureShape,
): void {
  const code = result.code ?? ''
  let type: LogType = 'runtime'
  if (code === 'TIMEOUT') type = 'timeout'
  else if (code === 'UNKNOWN_METHOD') type = 'not_found'
  else if (code === 'PARSE_ERROR') type = 'parse'
  else if (/config|spawn/i.test(code)) type = 'config'

  log.error(result.error || `worker.${method} failed`, {
    source: 'worker',
    type,
    detail: {
      method,
      code: code || undefined,
      durationMs: result.duration_ms,
      traceback: result.traceback,
    },
  })
}
