import { useCallback } from 'react'
import { useAppStore } from '../stores/app-store'

export function useApi() {
  const { backend } = useAppStore()

  const fetchApi = useCallback(
    async (path: string, options?: RequestInit) => {
      if (!backend.ready) throw new Error('Backend not connected')

      const url = `${backend.baseUrl}${path}`
      const headers = new Headers(options?.headers)
      headers.set('Authorization', `Bearer ${backend.token}`)

      if (options?.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json')
      }

      const response = await fetch(url, { ...options, headers })

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`)
      }

      return response.json()
    },
    [backend.ready, backend.baseUrl, backend.token]
  )

  const getStatus = useCallback(() => fetchApi('/api/status'), [fetchApi])

  const getSpectrum = useCallback(() => fetchApi('/api/spectrum'), [fetchApi])

  const getPeaks = useCallback(() => fetchApi('/api/peaks'), [fetchApi])

  const getFiles = useCallback(() => fetchApi('/api/workspace'), [fetchApi])

  const sendChat = useCallback(
    (message: string) =>
      fetchApi('/api/chat/send', {
        method: 'POST',
        body: JSON.stringify({ text: message }),
      }),
    [fetchApi]
  )

  const loadFile = useCallback(
    (filePath: string) =>
      fetchApi('/api/workspace/load', {
        method: 'POST',
        body: JSON.stringify({ path: filePath }),
      }),
    [fetchApi]
  )

  const previewSpectrumFile = useCallback(
    async (relPath: string) => {
      try {
        const result = await fetchApi(
          `/api/data/preview?path=${encodeURIComponent(relPath)}`,
        )
        if (result && !result.error && result.x?.length > 0) return result
      } catch { /* fall through to load-file + spectrum */ }

      const loadResult = await fetchApi('/api/pro/load-file', {
        method: 'POST',
        body: JSON.stringify({ rel_path: relPath }),
      })
      if (!loadResult?.success) {
        throw new Error(loadResult?.error || 'Backend failed to parse file')
      }
      return fetchApi('/api/spectrum')
    },
    [fetchApi],
  )

  // PyPI metadata lookup. Kept on `useApi` so the data boundary is
  // consistent with the rest of the REST surface and a future
  // lattice-cli proxy endpoint (e.g. `/api/compute/pypi/:name`) can
  // replace the direct pypi.org fetch without rippling through
  // consumers. For now the renderer calls PyPI directly — the fetch
  // does not require a backend token, so we intentionally skip the
  // `backend.ready` gate here.
  const getPypiMetadata = useCallback(
    async (name: string): Promise<Record<string, unknown> | null> => {
      const resp = await fetch(
        `https://pypi.org/pypi/${encodeURIComponent(name.trim())}/json`,
      )
      if (resp.status === 404) return null
      if (!resp.ok) {
        throw new Error(`PyPI lookup failed: ${resp.status}`)
      }
      const data = (await resp.json()) as { info?: Record<string, unknown> }
      return data.info ?? {}
    },
    [],
  )

  return {
    fetchApi,
    getStatus,
    getSpectrum,
    getPeaks,
    getFiles,
    sendChat,
    loadFile,
    previewSpectrumFile,
    getPypiMetadata,
  }
}
