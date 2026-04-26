// Optional legacy lattice-cli agent path: POST /api/chat/send + WebSocket
// task/tool/chat events.
//
// When the Python backend (lattice_cli.web.server) is running, agent turns
// should execute server-side with the full tool catalog — matching the
// legacy pro.html / index.html flow. The renderer already consumes the
// structured WS protocol in `useWebSocket.ts` (task_start, tool_*, chat_message,
// task_end, …). This module only kicks off the turn and waits for completion.
//
// Lattice-app is self-contained by default. Set
// `VITE_LATTICE_BACKEND_AGENT=1` only when explicitly testing the legacy
// lattice-cli agent bridge.

import { useAppStore } from '../stores/app-store'
import { wsClient } from '../stores/ws-client'
import type { MentionRef } from '../types/mention'
import type { SessionId } from '../types/session'

const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

const eventData = (event: unknown): unknown => {
  const obj = asObject(event)
  return Object.prototype.hasOwnProperty.call(obj, 'data') ? obj.data : event
}

function pickTaskId(obj: Record<string, unknown> | null): string | null {
  if (!obj) return null
  const a = obj.task_id
  const b = obj.taskId
  return typeof a === 'string' && a.length > 0
    ? a
    : typeof b === 'string' && b.length > 0
      ? b
      : null
}

function taskIdFromWsPayload(evt: unknown): string | null {
  const payload = eventData(evt)
  return pickTaskId(asObject(payload))
}

export function latticeBackendAgentPreferred(): boolean {
  if (import.meta.env.VITE_LATTICE_BACKEND_AGENT !== '1') return false
  return useAppStore.getState().backend.ready
}

export interface LatticeBackendAgentOptions {
  text: string
  sessionId: SessionId
  mentions?: Array<{ anchor: string; ref: MentionRef }>
  signal?: AbortSignal
}

/**
 * Fire `POST /api/chat/send` in agent mode, then block until the backend
 * emits `task_end` for the returned task id (or any `task_end` if the HTTP
 * response did not include an id — best-effort for older servers).
 */
export async function submitLatticeBackendAgentTurn(
  opts: LatticeBackendAgentOptions,
): Promise<{ ok: boolean; error?: string }> {
  const { backend } = useAppStore.getState()
  if (!backend.ready) {
    return { ok: false, error: 'Backend not connected' }
  }

  const url = `${backend.baseUrl}/api/chat/send`
  const body: Record<string, unknown> = {
    text: opts.text,
    mode: 'agent',
    session_id: opts.sessionId,
  }
  if (opts.mentions && opts.mentions.length > 0) {
    body.mentions = opts.mentions
  }

  // Start watching before POST. Very fast backend turns can emit task_end
  // before the HTTP response is parsed; missing that event leaves the
  // composer in a fake running state until the long timeout expires.
  const taskEndWaiter = createTaskEndWaiter(opts.signal)

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${backend.token}`,
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    })
  } catch (e) {
    taskEndWaiter.dispose()
    if (e instanceof DOMException && e.name === 'AbortError') {
      return { ok: false, error: 'Cancelled' }
    }
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }

  if (!res.ok) {
    taskEndWaiter.dispose()
    const t = await res.text().catch(() => '')
    return { ok: false, error: t || `HTTP ${res.status} ${res.statusText}` }
  }

  let json: Record<string, unknown> | null = null
  try {
    json = (await res.json()) as Record<string, unknown>
  } catch {
    json = null
  }

  const httpErr =
    json && typeof json.error === 'string'
      ? json.error
      : json && json.success === false && typeof json.message === 'string'
        ? json.message
        : null
  if (httpErr) {
    taskEndWaiter.dispose()
    return { ok: false, error: httpErr }
  }

  const expectedTaskId = pickTaskId(json)

  try {
    await taskEndWaiter.wait(expectedTaskId, 180_000)
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      return { ok: false, error: 'Cancelled' }
    }
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }

  return { ok: true }
}

function createTaskEndWaiter(signal?: AbortSignal): {
  wait(expectedTaskId: string | null, timeoutMs: number): Promise<void>
  dispose(): void
} {
  const endedTaskIds = new Set<string>()
  let sawAnyTaskEnd = false
  let disposed = false
  const waiters: Array<{
    expectedTaskId: string | null
    resolve: () => void
    reject: (err: unknown) => void
    timer: ReturnType<typeof setTimeout>
  }> = []

  const cleanupWaiter = (waiter: (typeof waiters)[number]) => {
    clearTimeout(waiter.timer)
    const idx = waiters.indexOf(waiter)
    if (idx >= 0) waiters.splice(idx, 1)
  }

  const unsubscribe = wsClient.on('task_end', (evt) => {
    sawAnyTaskEnd = true
    const tid = taskIdFromWsPayload(evt)
    if (tid) endedTaskIds.add(tid)
    for (const waiter of waiters.slice()) {
      if (waiter.expectedTaskId && tid !== waiter.expectedTaskId) continue
      cleanupWaiter(waiter)
      waiter.resolve()
    }
  })

  const dispose = (reason?: unknown) => {
    if (disposed) return
    disposed = true
    unsubscribe()
    signal?.removeEventListener('abort', onAbort)
    for (const waiter of waiters.slice()) {
      cleanupWaiter(waiter)
      if (reason !== undefined) waiter.reject(reason)
      else waiter.reject(new Error('disposed'))
    }
  }

  const onAbort = () => {
    dispose(new DOMException('aborted', 'AbortError'))
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  const finishWaiter = (waiter: (typeof waiters)[number], resolve: () => void) => {
    cleanupWaiter(waiter)
    dispose()
    resolve()
  }

  return {
    wait(expectedTaskId, timeoutMs) {
      if (expectedTaskId ? endedTaskIds.has(expectedTaskId) : sawAnyTaskEnd) {
        dispose()
        return Promise.resolve()
      }
      if (signal?.aborted) {
        dispose()
        return Promise.reject(new DOMException('aborted', 'AbortError'))
      }
      return new Promise<void>((resolve, reject) => {
        const waiter = {
          expectedTaskId,
          resolve: () => finishWaiter(waiter, resolve),
          reject,
          timer: setTimeout(() => {
            cleanupWaiter(waiter)
            dispose()
            reject(
              new Error(
                'Timed out waiting for backend agent (no task_end on WebSocket)',
              ),
            )
          }, timeoutMs),
        }
        waiters.push(waiter)
      })
    },
    dispose,
  }
}
