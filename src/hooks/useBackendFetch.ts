// Shared bearer-authed fetch primitives used by domain API hooks.
//
// Each domain hook (library, knowledge, ...) defines its own error class
// + "not ready" sentinel so callers can branch on instanceof. This hook
// returns fetch variants wired to the current backend, throwing via the
// caller-supplied error factories so the existing error surface is
// preserved.

import { useCallback } from 'react'
import { useAppStore } from '../stores/app-store'

export interface BackendFetchErrors {
  notReady: () => Error
  http: (message: string, status: number, body: string) => Error
}

export interface BackendFetch {
  /** JSON request → parsed JSON response. Throws on non-2xx. */
  jsonFetch: <T>(path: string, init?: RequestInit) => Promise<T>
  /** Raw request; returns the Response (caller consumes body). */
  rawFetch: (path: string, init?: RequestInit) => Promise<Response>
  /** multipart/form-data POST → parsed JSON response. */
  multipartFetch: <T>(path: string, form: FormData) => Promise<T>
  readonly ready: boolean
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

export function useBackendFetch(errors: BackendFetchErrors): BackendFetch {
  const backend = useAppStore((s) => s.backend)

  const jsonFetch = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      if (!backend.ready) throw errors.notReady()
      const res = await fetch(`${backend.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${backend.token}`,
          'Content-Type': 'application/json',
          ...(init?.headers ?? {}),
        },
      })
      if (!res.ok) {
        const body = await safeText(res)
        throw errors.http(
          `HTTP ${res.status} ${res.statusText}`,
          res.status,
          body,
        )
      }
      return (await res.json()) as T
    },
    [backend.ready, backend.baseUrl, backend.token, errors],
  )

  const rawFetch = useCallback(
    async (path: string, init?: RequestInit): Promise<Response> => {
      if (!backend.ready) throw errors.notReady()
      const res = await fetch(`${backend.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${backend.token}`,
          ...(init?.headers ?? {}),
        },
      })
      if (!res.ok) {
        const body = await safeText(res)
        throw errors.http(
          `HTTP ${res.status} ${res.statusText}`,
          res.status,
          body,
        )
      }
      return res
    },
    [backend.ready, backend.baseUrl, backend.token, errors],
  )

  const multipartFetch = useCallback(
    async <T,>(path: string, form: FormData): Promise<T> => {
      if (!backend.ready) throw errors.notReady()
      const res = await fetch(`${backend.baseUrl}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${backend.token}` },
        body: form,
      })
      if (!res.ok) {
        const body = await safeText(res)
        throw errors.http(
          `HTTP ${res.status} ${res.statusText}`,
          res.status,
          body,
        )
      }
      return (await res.json()) as T
    },
    [backend.ready, backend.baseUrl, backend.token, errors],
  )

  return { jsonFetch, rawFetch, multipartFetch, ready: backend.ready }
}
