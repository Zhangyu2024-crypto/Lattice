// Hook: owns the filter state, debounced backend search, and the
// current result-set / selection / mode for KnowledgeBrowserModal.
//
// Why split: the parent modal was juggling 5 search-related useStates
// and 2 request-id refs alongside detail + compare + export state.
// This keeps the "what the user is searching for and what came back"
// concern in one place; the modal consumes it as `{filters, setFilter,
// results, selected, setSelected, ...}`.

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '../../stores/toast-store'
import type {
  KnowledgeChainMatch,
  KnowledgeSearchQuery,
  KnowledgeSearchResponse,
} from '../../types/knowledge-api'
import type { localProKnowledge } from '../../lib/local-pro-knowledge'
import { INITIAL_FILTERS, type FilterState, type Mode } from './modal/types'

const DEBOUNCE_MS = 300

type KnowledgeApi = typeof localProKnowledge

function flattenSearchResponse(res: KnowledgeSearchResponse): {
  type: Mode
  rows: KnowledgeChainMatch[]
} {
  if (res.type === 'material') {
    const data = res.data
    const rows: KnowledgeChainMatch[] = []
    const add = (v: unknown) => {
      if (Array.isArray(v)) rows.push(...(v as KnowledgeChainMatch[]))
    }
    add(data?.params)
    add(data?.results)
    return { type: 'material', rows }
  }
  return {
    type: res.type as Mode,
    rows: Array.isArray(res.results)
      ? (res.results as KnowledgeChainMatch[])
      : [],
  }
}

export interface UseKnowledgeSearch {
  filters: FilterState
  setFilters: (next: FilterState) => void
  resetFilters: () => void
  results: KnowledgeChainMatch[]
  mode: Mode
  selected: KnowledgeChainMatch | null
  setSelected: (
    next:
      | KnowledgeChainMatch
      | null
      | ((prev: KnowledgeChainMatch | null) => KnowledgeChainMatch | null),
  ) => void
  isSearching: boolean
  errorMsg: string | null
  /** Run a fresh search without debounce — used after a mutation like delete. */
  refetch: () => void
  /** Invalidate in-flight search writes (e.g. on modal close / backend swap). */
  cancel: () => void
  /** Reset local state — used when modal closes. */
  reset: () => void
}

interface Options {
  api: KnowledgeApi
  open: boolean
}

export function useKnowledgeSearch({ api, open }: Options): UseKnowledgeSearch {
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS)
  const [results, setResults] = useState<KnowledgeChainMatch[]>([])
  const [mode, setMode] = useState<Mode>('browse')
  const [selected, setSelected] = useState<KnowledgeChainMatch | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const openRef = useRef(open)
  const searchTimer = useRef<number | null>(null)
  const searchReqId = useRef(0)

  useEffect(() => {
    openRef.current = open
  }, [open])

  const runSearch = useCallback(
    async (q: FilterState) => {
      if (!api.ready) return
      const reqId = ++searchReqId.current
      setIsSearching(true)
      setErrorMsg(null)
      try {
        const searchQ: KnowledgeSearchQuery = {
          q: q.q || undefined,
          material: q.material || undefined,
          metric: q.metric || undefined,
          technique: q.technique || undefined,
          min_confidence: q.min_confidence || undefined,
          tag: q.tag || undefined,
          limit: 100,
        }
        const res: KnowledgeSearchResponse = await api.search(searchQ)
        if (!openRef.current || reqId !== searchReqId.current) return
        const { type, rows } = flattenSearchResponse(res)
        setMode(type)
        setResults(rows)
        setSelected(rows[0] ?? null)
      } catch (err) {
        if (!openRef.current || reqId !== searchReqId.current) return
        const msg = err instanceof Error ? err.message : String(err)
        setErrorMsg(msg)
        toast.error(`Search failed: ${msg}`)
      } finally {
        if (openRef.current && reqId === searchReqId.current) {
          setIsSearching(false)
        }
      }
    },
    [api],
  )

  useEffect(() => {
    if (!open || !api.ready) return
    if (searchTimer.current != null) {
      window.clearTimeout(searchTimer.current)
    }
    searchTimer.current = window.setTimeout(() => {
      void runSearch(filters)
    }, DEBOUNCE_MS)
    return () => {
      if (searchTimer.current != null) {
        window.clearTimeout(searchTimer.current)
        searchTimer.current = null
      }
    }
  }, [open, api.ready, filters, runSearch])

  const refetch = useCallback(() => {
    void runSearch(filters)
  }, [filters, runSearch])

  const cancel = useCallback(() => {
    searchReqId.current += 1
  }, [])

  const resetFilters = useCallback(() => {
    setFilters(INITIAL_FILTERS)
  }, [])

  const reset = useCallback(() => {
    searchReqId.current += 1
    setFilters(INITIAL_FILTERS)
    setResults([])
    setMode('browse')
    setSelected(null)
    setIsSearching(false)
    setErrorMsg(null)
  }, [])

  return {
    filters,
    setFilters,
    resetFilters,
    results,
    mode,
    selected,
    setSelected,
    isSearching,
    errorMsg,
    refetch,
    cancel,
    reset,
  }
}
