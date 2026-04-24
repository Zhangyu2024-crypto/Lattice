// lattice-cli agent path: POST /api/chat/send + WebSocket task/tool/chat events.
//
// When the Python backend (lattice_cli.web.server) is running, agent turns
// should execute server-side with the full tool catalog — matching the
// legacy pro.html / index.html flow. The renderer already consumes the
// structured WS protocol in `useWebSocket.ts` (task_start, tool_*, chat_message,
// task_end, …). This module only kicks off the turn and waits for completion.
//
// Set `VITE_LATTICE_BACKEND_AGENT=0` to force the local TS orchestrator even
// when the backend is up (debug only).

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
  if (import.meta.env.VITE_LATTICE_BACKEND_AGENT === '0') return false
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
    if (e instanceof DOMException && e.name === 'AbortError') {
      return { ok: false, error: 'Cancelled' }
    }
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }

  if (!res.ok) {
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
  if (httpErr) return { ok: false, error: httpErr }

  const expectedTaskId = pickTaskId(json)

  try {
    await waitForBackendTaskEnd({
      expectedTaskId,
      signal: opts.signal,
      timeoutMs: 180_000,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      return { ok: false, error: 'Cancelled' }
    }
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }

  return { ok: true }
}

function waitForBackendTaskEnd(opts: {
  expectedTaskId: string | null
  signal?: AbortSignal
  timeoutMs: number
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(
        new Error(
          'Timed out waiting for backend agent (no task_end on WebSocket)',
        ),
      )
    }, opts.timeoutMs)

    const unsubscribe = wsClient.on('task_end', (evt) => {
      const tid = taskIdFromWsPayload(evt)
      if (opts.expectedTaskId) {
        if (tid === opts.expectedTaskId) {
          cleanup()
          resolve()
        }
        return
      }
      // No task id from HTTP — accept the next task_end (may race with other
      // tabs; prefer configuring lattice-cli to return task_id).
      cleanup()
      resolve()
    })

    const onAbort = () => {
      cleanup()
      reject(new DOMException('aborted', 'AbortError'))
    }

    function cleanup() {
      clearTimeout(timer)
      unsubscribe()
      opts.signal?.removeEventListener('abort', onAbort)
    }

    if (opts.signal?.aborted) {
      cleanup()
      reject(new DOMException('aborted', 'AbortError'))
      return
    }
    opts.signal?.addEventListener('abort', onAbort)
  })
}
