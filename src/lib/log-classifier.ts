// Pure helpers for the logging system. Live in their own module so the
// logger, stores, and tests can import them without pulling in the
// Zustand store at classification time.
//
// No React, no side effects — safe to import from anywhere.

import { errorMessage } from './error-message'

// ─── Source / Type taxonomies ───────────────────────────────────────

export const LOG_SOURCES = [
  'ui',
  'agent',
  'llm',
  'worker',
  'library',
  'knowledge',
  'pro',
  'compute',
  'sync',
  'workspace',
  'latex',
  'ipc',
  'console',
  'boundary',
  'window',
  'system',
] as const
export type LogSource = (typeof LOG_SOURCES)[number]

export const LOG_TYPES = [
  'runtime',
  'network',
  'http',
  'config',
  'parse',
  'validation',
  'permission',
  'timeout',
  'not_found',
  'abort',
  'external',
  'unknown',
] as const
export type LogType = (typeof LOG_TYPES)[number]

export const LOG_LEVELS = ['error', 'warn', 'info', 'success'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

// ─── Classifiers ────────────────────────────────────────────────────

/**
 * Map an HTTP response status to a LogType so API callers don't each
 * reinvent the mapping. Non-HTTP contexts should use `classifyError` or
 * pick a LogType directly.
 */
export function statusToType(status: number): LogType {
  if (status === 401 || status === 403) return 'permission'
  if (status === 404) return 'not_found'
  if (status === 408 || status === 504) return 'timeout'
  if (status >= 500) return 'http'
  if (status >= 400) return 'http'
  return 'runtime'
}

/**
 * Derive a LogSource from a URL path so the backend fetch hook doesn't
 * need each caller to pass a source. Matches paths, not hostnames — if
 * no prefix matches, falls back to `'ipc'` for same-origin / unknown
 * paths.
 */
export function pathToSource(url: string): LogSource {
  try {
    const path = url.startsWith('http') ? new URL(url).pathname : url
    if (path.includes('/api/knowledge')) return 'knowledge'
    if (path.includes('/api/library')) return 'library'
    if (path.includes('/api/pro')) return 'pro'
    if (path.includes('/api/llm')) return 'llm'
    if (path.includes('/api/compute')) return 'compute'
    if (path.includes('/api/workspace')) return 'workspace'
    if (path.includes('/api/sync')) return 'sync'
    return 'ipc'
  } catch {
    return 'ipc'
  }
}

/**
 * Best-effort LogType for an arbitrary thrown value. Recognises common
 * shapes (AbortError, SyntaxError, our custom API errors) and falls back
 * to pattern matching on the message text. Returns 'runtime' if nothing
 * else fits.
 */
export function classifyError(err: unknown): LogType {
  if (err && typeof err === 'object') {
    // Custom API error classes carry a `status` field — treat them as http.
    const maybeStatus = (err as { status?: unknown }).status
    if (typeof maybeStatus === 'number') {
      return statusToType(maybeStatus)
    }
    // DOMException.AbortError
    if (
      typeof DOMException !== 'undefined' &&
      err instanceof DOMException &&
      err.name === 'AbortError'
    ) {
      return 'abort'
    }
    const name = (err as { name?: unknown }).name
    if (name === 'AbortError') return 'abort'
    if (err instanceof SyntaxError) return 'parse'
    if (err instanceof TypeError) return 'runtime'
  }

  const msg = errorMessage(err).toLowerCase()
  if (!msg) return 'runtime'
  if (/abort(ed)?/.test(msg)) return 'abort'
  if (/timeout|timed out|etimedout/.test(msg)) return 'timeout'
  if (/not[-_ ]?found|does not exist/.test(msg)) return 'not_found'
  if (/denied|forbidden|unauthori[sz]ed|permission/.test(msg)) {
    return 'permission'
  }
  if (/econnrefused|enotfound|eai_again|network|offline|fetch failed/.test(msg)) {
    return 'network'
  }
  if (/json|parse|syntax|invalid token/.test(msg)) return 'parse'
  return 'runtime'
}

/** Truncate a string to `max` bytes (approx by code units). Returns the
 *  original unchanged if it already fits. Callers that care about
 *  round-tripping should store the flag themselves. */
export function truncate(text: string | undefined, max: number): string | undefined {
  if (text == null) return undefined
  if (text.length <= max) return text
  return text.slice(0, max) + `…[+${text.length - max} chars]`
}
