// Default demo executor for the local batch runner.
//
// Simulates a per-file analysis with a random delay and a configurable
// success rate, purely client-side. This is the placeholder that keeps
// BatchWorkflowCard functional without any backend; real per-pipeline
// executors (e.g. run peak-detect through the compute container) slot in
// alongside this one under `src/lib/batch-executors/`.

import type { BatchExecutor, BatchExecutorResult } from '../batch-runner'

const DEFAULT_MIN_MS = 350
const DEFAULT_MAX_MS = 1200
const DEFAULT_SUCCESS_RATE = 0.85

interface MockExecutorOptions {
  minMs?: number
  maxMs?: number
  /** 0..1 — probability of success per file. */
  successRate?: number
}

export function mockBatchExecutor(
  options: MockExecutorOptions = {},
): BatchExecutor {
  const minMs = options.minMs ?? DEFAULT_MIN_MS
  const maxMs = Math.max(options.maxMs ?? DEFAULT_MAX_MS, minMs)
  const successRate = Math.max(0, Math.min(1, options.successRate ?? DEFAULT_SUCCESS_RATE))

  return async ({ signal }): Promise<BatchExecutorResult> => {
    const started = Date.now()
    const delay = Math.round(minMs + Math.random() * (maxMs - minMs))

    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason ?? new Error('Aborted'))
        return
      }
      const timer = setTimeout(() => {
        cleanup()
        resolve()
      }, delay)
      const onAbort = () => {
        cleanup()
        reject(signal.reason ?? new Error('Aborted'))
      }
      const cleanup = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })

    const succeeded = Math.random() < successRate
    const durationMs = Date.now() - started
    if (!succeeded) {
      throw new Error('Mock failure (demo executor: random outcome)')
    }
    return { durationMs }
  }
}
