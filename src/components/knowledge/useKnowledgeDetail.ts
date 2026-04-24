// Hook: owns the per-extraction detail cache + in-flight dedup for
// KnowledgeBrowserModal.
//
// Why split: the parent modal had a Map ref, a request-id counter, a
// tag-draft string, a loading flag, and the detail value itself — all
// driven by the selected extraction id. Bundling them here lets the
// modal pass `selectedId` in and get `{detail, loading, ...}` back.

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '../../stores/toast-store'
import type { KnowledgeExtractionDetail } from '../../types/knowledge-api'
import type { localProKnowledge } from '../../lib/local-pro-knowledge'

type KnowledgeApi = typeof localProKnowledge

export interface UseKnowledgeDetail {
  detail: KnowledgeExtractionDetail | null
  loading: boolean
  tagDraft: string
  setTagDraft: (next: string) => void
  /**
   * Drop the cached detail for `extractionId`; the next load will hit
   * the backend. Used after tag mutations.
   */
  invalidate: (extractionId: number) => void
  /** Force a fresh fetch for the given id, bypassing the cache. */
  reload: (extractionId: number) => Promise<void>
  /** Reset local state — used when modal closes. */
  reset: () => void
}

interface Options {
  api: KnowledgeApi
  open: boolean
  /** The currently selected extraction (null = no selection). */
  selectedId: number | null
}

export function useKnowledgeDetail({
  api,
  open,
  selectedId,
}: Options): UseKnowledgeDetail {
  const [detail, setDetail] = useState<KnowledgeExtractionDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [tagDraft, setTagDraft] = useState('')

  const openRef = useRef(open)
  const detailReqId = useRef(0)
  const cache = useRef<Map<number, KnowledgeExtractionDetail>>(new Map())

  useEffect(() => {
    openRef.current = open
  }, [open])

  const fetchDetail = useCallback(
    async (extractionId: number, opts?: { bypassCache?: boolean }) => {
      if (!api.ready) return
      const cached = cache.current.get(extractionId)
      if (cached && !opts?.bypassCache) {
        setDetail(cached)
        setLoading(false)
        return
      }
      const reqId = ++detailReqId.current
      setLoading(true)
      try {
        const res = await api.getExtraction(extractionId)
        if (!openRef.current || reqId !== detailReqId.current) return
        cache.current.set(extractionId, res)
        setDetail(res)
      } catch (err) {
        if (!openRef.current || reqId !== detailReqId.current) return
        toast.error(
          `Detail load failed: ${err instanceof Error ? err.message : String(err)}`,
        )
        setDetail(null)
      } finally {
        if (openRef.current && reqId === detailReqId.current) {
          setLoading(false)
        }
      }
    },
    [api],
  )

  // Auto-load whenever the selected id changes (while open).
  useEffect(() => {
    if (!open) return
    setTagDraft('')
    if (selectedId == null) {
      detailReqId.current += 1
      setDetail(null)
      setLoading(false)
      return
    }
    void fetchDetail(selectedId)
  }, [open, selectedId, fetchDetail])

  const invalidate = useCallback((extractionId: number) => {
    cache.current.delete(extractionId)
  }, [])

  const reload = useCallback(
    (extractionId: number) => fetchDetail(extractionId, { bypassCache: true }),
    [fetchDetail],
  )

  const reset = useCallback(() => {
    detailReqId.current += 1
    cache.current.clear()
    setDetail(null)
    setLoading(false)
    setTagDraft('')
  }, [])

  return {
    detail,
    loading,
    tagDraft,
    setTagDraft,
    invalidate,
    reload,
    reset,
  }
}
