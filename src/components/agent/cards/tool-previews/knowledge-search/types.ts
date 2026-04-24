// Phase 3b · knowledge_search preview — input/output shape narrowing + hits.
//
// The orchestrator's tool result is `unknown` at the registry boundary, so
// we narrow into discriminated structs here and flatten the material-mode
// envelope's `data.params` / `data.results` buckets alongside the
// metric/technique/fts/browse flat `results` array into a uniform `Hit`
// stream. Kept pure so render components stay dependency-light.

import type {
  KnowledgeChainMatch,
  KnowledgeSearchResponse,
} from '@/types/knowledge-api'

export interface KnowledgeSearchInput {
  q?: string
  material?: string
  metric?: string
  technique?: string
  tag?: string
  limit?: number
  min_confidence?: number
}

export interface KnowledgeSearchOutputRaw {
  type?: string
  count?: number
  data?: KnowledgeSearchResponse
}

export interface Hit {
  chainId: number
  paperId?: number
  title: string
  snippet: string
  confidence?: number
  mode: string
  bucket?: 'params' | 'results' | 'spectra'
}

export function narrowInput(value: unknown): KnowledgeSearchInput {
  if (!value || typeof value !== 'object') return {}
  const v = value as Record<string, unknown>
  const pickStr = (k: string): string | undefined =>
    typeof v[k] === 'string' && (v[k] as string).length > 0
      ? (v[k] as string)
      : undefined
  const pickNum = (k: string): number | undefined =>
    typeof v[k] === 'number' && Number.isFinite(v[k]) ? (v[k] as number) : undefined
  return {
    q: pickStr('q'),
    material: pickStr('material'),
    metric: pickStr('metric'),
    technique: pickStr('technique'),
    tag: pickStr('tag'),
    limit: pickNum('limit'),
    min_confidence: pickNum('min_confidence'),
  }
}

export function narrowOutput(value: unknown): KnowledgeSearchOutputRaw | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (!v.data || typeof v.data !== 'object') return null
  const type = typeof v.type === 'string' ? v.type : undefined
  const count =
    typeof v.count === 'number' && Number.isFinite(v.count) ? v.count : undefined
  return {
    type,
    count,
    data: v.data as KnowledgeSearchResponse,
  }
}

export function extractHits(output: KnowledgeSearchOutputRaw): Hit[] {
  const data = output.data
  if (!data) return []
  const mode = data.type ?? output.type ?? 'search'
  if (data.type === 'material') {
    const hits: Hit[] = []
    const bag = data.data ?? {}
    // The material envelope's `data` bag declares an `[k: string]: unknown`
    // index signature, so TS widens `bag.params` to `unknown` even when the
    // declared type is `KnowledgeChainMatch[]`. Narrow through an explicit
    // asCast after the Array.isArray guard.
    const params: KnowledgeChainMatch[] = Array.isArray(bag.params)
      ? (bag.params as KnowledgeChainMatch[])
      : []
    const results: KnowledgeChainMatch[] = Array.isArray(bag.results)
      ? (bag.results as KnowledgeChainMatch[])
      : []
    for (const m of params) hits.push(chainToHit(m, mode, 'params'))
    for (const m of results) hits.push(chainToHit(m, mode, 'results'))
    return hits
  }
  const results: KnowledgeChainMatch[] = Array.isArray(data.results)
    ? data.results
    : []
  return results.map((m) => chainToHit(m, mode))
}

export function chainToHit(
  match: KnowledgeChainMatch,
  mode: string,
  bucket?: Hit['bucket'],
): Hit {
  const title = match.paper_title?.trim() || `Paper ${match.paper_id ?? '?'}`
  const section = match.context_section
  const context = match.context_text?.trim()
  // Fall back to the chain's measurement/state nodes when the server didn't
  // include surrounding prose — knowledge_db rows often omit context_text
  // and the nodes themselves are the most informative substring.
  const fromNodes = match.nodes
    ?.map((n) => {
      if (!n?.name) return null
      const unit = n.unit ? ` ${n.unit}` : ''
      if (n.value) return `${n.name} = ${n.value}${unit}`
      if (typeof n.value_numeric === 'number')
        return `${n.name} = ${n.value_numeric}${unit}`
      return n.name
    })
    .filter((x): x is string => Boolean(x))
    .slice(0, 4)
    .join(' · ')
  const snippet = context || fromNodes || '(no excerpt)'
  return {
    chainId: match.chain_id,
    paperId: match.paper_id,
    title: section ? `${title} — ${section}` : title,
    snippet,
    confidence: match.confidence,
    mode,
    bucket,
  }
}
