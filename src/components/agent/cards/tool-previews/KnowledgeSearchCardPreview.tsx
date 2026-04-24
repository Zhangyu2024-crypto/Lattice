// Phase 3b · knowledge_search preview card.
//
// Surfaces the chain-matches returned by the knowledge-graph search endpoint
// as a scannable list: each hit renders its paper title, a tightly-scoped
// excerpt pulled from the originating section, a confidence chip, and a
// source/kind chip. Clicking a source chip copies the paper id to the
// clipboard — there is no cross-renderer "open paper" event today, but we
// expose the affordance so the user can paste the id straight into the
// library or the composer.
//
// Shape narrowing leans on the `KnowledgeSearchResponse` discriminated union
// at `src/types/knowledge-api.ts` — the material-mode branch carries results
// inside `data.results` / `data.params`, whereas metric/technique/fts/browse
// all expose a flat `results` array. We flatten both into a single
// `Hit` stream before rendering so the presentation stays uniform.
//
// The card was split into ./knowledge-search/* helpers after it crossed
// 500 lines — this file keeps the resolver, the registry-facing export,
// and the top-level Body / ExpandedBody layouts so the preview-registry
// wiring stays at the same import path.

import { useState } from 'react'
import type { ToolPreviewResolver } from '../preview-registry'
import { HitList } from './knowledge-search/HitList'
import { QueryHeader } from './knowledge-search/QueryHeader'
import { Footer, Malformed } from './knowledge-search/states'
import {
  extractHits,
  narrowInput,
  narrowOutput,
  type Hit,
  type KnowledgeSearchInput,
  type KnowledgeSearchOutputRaw,
} from './knowledge-search/types'

function Body({
  input,
  output,
  hits,
  cap,
  maxHeight,
}: {
  input: KnowledgeSearchInput
  output: KnowledgeSearchOutputRaw
  hits: Hit[]
  cap: number | null
  maxHeight: number
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <QueryHeader input={input} output={output} />
      {hits.length === 0 ? (
        <span
          style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}
        >
          No hits
        </span>
      ) : (
        <div style={{ maxHeight, overflow: 'auto' }}>
          <HitList hits={hits} cap={cap} />
        </div>
      )}
      <Footer
        total={hits.length}
        shown={cap != null ? Math.min(cap, hits.length) : hits.length}
      />
    </div>
  )
}

function ExpandedBody({
  input,
  output,
  hits,
}: {
  input: KnowledgeSearchInput
  output: KnowledgeSearchOutputRaw
  hits: Hit[]
}) {
  const [showAll, setShowAll] = useState(false)
  const cap = showAll ? null : 12
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Body
        input={input}
        output={output}
        hits={hits}
        cap={cap}
        maxHeight={480}
      />
      {!showAll && hits.length > 12 ? (
        <button
          type="button"
          className="agent-card-btn"
          onClick={() => setShowAll(true)}
          style={{ fontSize: 'var(--text-xs)', alignSelf: 'flex-start' }}
        >
          Show all {hits.length}
        </button>
      ) : null}
    </div>
  )
}

export const KnowledgeSearchPreview: ToolPreviewResolver = (step) => {
  const input = narrowInput(step.input)
  const output = narrowOutput(step.output)

  if (!output) {
    const inputParts: string[] = []
    if (input.q) inputParts.push(input.q)
    if (input.material) inputParts.push(`material:${input.material}`)
    if (input.metric) inputParts.push(`metric:${input.metric}`)
    return {
      oneLiner: inputParts.length > 0
        ? `knowledge_search · ${inputParts.join(' ')}`
        : 'knowledge_search',
      compact: <Malformed />,
    }
  }

  const hits = extractHits(output)
  const total = typeof output.count === 'number' ? output.count : hits.length
  const modeLabel = output.type ?? 'search'
  const queryLabel =
    input.q || input.material || input.metric || input.technique || input.tag
  const oneLiner = `${total} hit${total === 1 ? '' : 's'} · ${modeLabel}${
    queryLabel ? ` · ${queryLabel}` : ''
  }`

  // Keep the resolver-level render separate from the hooks-bearing component:
  // ExpandedBody owns useState / toggle state. Compact is a shallow view.
  return {
    oneLiner,
    compact: (
      <Body
        input={input}
        output={output}
        hits={hits}
        cap={3}
        maxHeight={220}
      />
    ),
    expanded: <ExpandedBody input={input} output={output} hits={hits} />,
  }
}
