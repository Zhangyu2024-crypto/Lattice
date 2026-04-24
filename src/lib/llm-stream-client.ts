// Renderer-side wrapper for the Electron IPC streaming protocol.
//
// Subscribes to `llm:stream-chunk` / `llm:stream-tool-use` / `llm:stream-end`
// events pushed by the main process's `llm-stream.ts`, filters by streamId, and
// resolves the returned promise with the same `LlmInvokeResultPayload` that the
// one-shot `llmInvoke` path returns. Callers receive incremental text deltas via
// an `onTextDelta` callback so the UI can render tokens as they arrive.
//
// Abort support: pass a standard `AbortSignal`; when it fires we forward to
// `llmStreamAbort(streamId)` so the main process tears down the HTTP connection.

import type {
  LlmInvokeRequestPayload,
  LlmInvokeResultPayload,
  LlmStreamChunkEvent,
  LlmStreamToolUseEvent,
  LlmStreamEndEvent,
} from '../types/electron'

export interface LlmStreamCallbacks {
  /** Fired for every incremental text token. */
  onTextDelta?: (delta: string) => void
}

/**
 * Send an LLM request using the streaming IPC transport. Returns the same
 * result shape as a one-shot `llmInvoke` call.
 *
 * @throws When `window.electronAPI.llmStreamStart` is unavailable (Vite-only
 *         mode) or when the main process rejects the start request.
 */
export function sendLlmStream(
  request: LlmInvokeRequestPayload,
  callbacks: LlmStreamCallbacks,
  signal?: AbortSignal,
): Promise<LlmInvokeResultPayload> {
  const electron = window.electronAPI
  if (!electron?.llmStreamStart) {
    return Promise.reject(new Error('LLM streaming not available — requires Electron shell.'))
  }

  return new Promise<LlmInvokeResultPayload>((resolve, reject) => {
    let unsubChunk: (() => void) | undefined
    let unsubToolUse: (() => void) | undefined
    let unsubEnd: (() => void) | undefined
    let streamId: string | undefined
    let settled = false

    const cleanup = () => {
      unsubChunk?.()
      unsubToolUse?.()
      unsubEnd?.()
    }

    const settle = (result: LlmInvokeResultPayload) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }

    const fail = (error: string) => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(error))
    }

    // Wire abort signal to the stream-abort IPC.
    const onAbort = () => {
      if (streamId && electron.llmStreamAbort) {
        electron.llmStreamAbort(streamId)
      }
    }
    if (signal) {
      if (signal.aborted) {
        reject(new Error('Aborted before stream started'))
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }

    // Subscribe to IPC push events BEFORE starting the stream to avoid
    // missing early deltas (the main process fires events asynchronously).
    unsubChunk = electron.onLlmStreamChunk?.((event: LlmStreamChunkEvent) => {
      if (event.streamId === streamId) {
        callbacks.onTextDelta?.(event.textDelta)
      }
    })

    unsubToolUse = electron.onLlmStreamToolUse?.((_event: LlmStreamToolUseEvent) => {
      // Tool-use events are consumed via the final result's `toolCalls`;
      // this subscription is kept as an extension point for future UI that
      // wants to show tool calls as they arrive.
    })

    unsubEnd = electron.onLlmStreamEnd?.((event: LlmStreamEndEvent) => {
      if (event.streamId === streamId) {
        signal?.removeEventListener('abort', onAbort)
        settle(event.result)
      }
    })

    // Kick off the stream.
    electron.llmStreamStart(request).then(
      (startResult) => {
        if (!startResult.ok) {
          signal?.removeEventListener('abort', onAbort)
          fail(startResult.error)
          return
        }
        streamId = startResult.streamId

        // If abort fired between our subscribe and start resolving, send
        // abort now.
        if (signal?.aborted) {
          onAbort()
        }
      },
      (err) => {
        signal?.removeEventListener('abort', onAbort)
        fail(err instanceof Error ? err.message : String(err))
      },
    )
  })
}
