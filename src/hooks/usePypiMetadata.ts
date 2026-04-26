// usePypiMetadata — cached PyPI metadata fetch for Compute Package
// drawers. Uses a 5-minute in-memory Map so re-opening a package drawer
// or switching between packages in the same session skips the network
// round-trip. This is intentionally independent of the legacy REST bridge.

import { useEffect, useState } from 'react'

export interface PyPiMeta {
  summary?: string
  description?: string
  home_page?: string
  author?: string
  license?: string
  requires_python?: string
  version?: string
  requires_dist?: string[]
  // Catch-all: PyPI returns a lot we don't actively use.
  [key: string]: unknown
}

interface CacheEntry {
  data: PyPiMeta | null
  at: number
}

const CACHE_TTL_MS = 5 * 60 * 1000
const pypiCache = new Map<string, CacheEntry>()

async function fetchPypiMetadata(name: string): Promise<PyPiMeta | null> {
  const resp = await fetch(
    `https://pypi.org/pypi/${encodeURIComponent(name.trim())}/json`,
  )
  if (resp.status === 404) return null
  if (!resp.ok) {
    throw new Error(`PyPI lookup failed: ${resp.status}`)
  }
  const data = (await resp.json()) as { info?: PyPiMeta }
  return data.info ?? {}
}

export interface UsePypiMetadataResult {
  data: PyPiMeta | null
  loading: boolean
  error: string | null
}

export function usePypiMetadata(name: string | null): UsePypiMetadataResult {
  const [state, setState] = useState<UsePypiMetadataResult>({
    data: null,
    loading: false,
    error: null,
  })

  useEffect(() => {
    if (!name) {
      setState({ data: null, loading: false, error: null })
      return
    }
    const key = name.toLowerCase()
    const cached = pypiCache.get(key)
    const fresh = cached && Date.now() - cached.at < CACHE_TTL_MS
    if (fresh && cached) {
      setState({ data: cached.data, loading: false, error: null })
      return
    }
    let cancelled = false
    setState({ data: cached?.data ?? null, loading: true, error: null })
    ;(async () => {
      try {
        const raw = await fetchPypiMetadata(name)
        if (cancelled) return
        const data = (raw ?? null) as PyPiMeta | null
        pypiCache.set(key, { data, at: Date.now() })
        setState({ data, loading: false, error: null })
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        setState({ data: cached?.data ?? null, loading: false, error: message })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [name])

  return state
}

export default usePypiMetadata
