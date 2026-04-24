// usePypiMetadata — cached PyPI metadata fetch for Compute Package
// drawers. Wraps `useApi.getPypiMetadata` behind a 5-minute in-memory
// Map so re-opening a package drawer or switching between packages in
// the same session skips the network round-trip.
//
// The underlying fetch currently hits `pypi.org/pypi/:name/json`
// directly (see useApi). A future lattice-cli endpoint will proxy the
// lookup; callers of this hook won't change.

import { useEffect, useState } from 'react'
import { useApi } from './useApi'

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

export interface UsePypiMetadataResult {
  data: PyPiMeta | null
  loading: boolean
  error: string | null
}

export function usePypiMetadata(name: string | null): UsePypiMetadataResult {
  const { getPypiMetadata } = useApi()
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
        const raw = await getPypiMetadata(name)
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
  }, [name, getPypiMetadata])

  return state
}

export default usePypiMetadata
