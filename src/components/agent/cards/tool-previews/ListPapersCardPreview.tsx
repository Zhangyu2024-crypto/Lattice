// Phase 3b · list_papers preview card.
//
// Parallels LiteratureSearchCardPreview but is scoped to the local Library:
// the agent is browsing already-imported papers rather than issuing an
// external search. Rows render the library metadata (id, title, authors,
// year, journal, tags, PDF flag) and clicking a row copies its paper id
// to the clipboard so the user can paste it into the composer or another
// tool call. Header shows total / returned so the LLM's `limit` decision
// stays visible.
//
// The card was split into ./list-papers/* helpers once it crossed ~500
// lines — this file keeps the resolver, the registry-facing export, and
// the top-level Body / ExpandedBody / PaperList layout so the existing
// preview-registry import path continues to work unchanged.

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { ToolPreviewResolver } from '../preview-registry'
import { PaperRow } from './list-papers/PaperRow'
import { QueryHeader } from './list-papers/QueryHeader'
import { Footer, Malformed } from './list-papers/states'
import {
  narrowInput,
  narrowOutput,
  type LibraryPaperRow,
  type ListPapersInput,
  type ListPapersOutput,
} from './list-papers/types'

function PaperList({
  rows,
  cap,
}: {
  rows: LibraryPaperRow[]
  cap: number | null
}) {
  const shown = cap != null ? rows.slice(0, cap) : rows
  const remainder = cap != null ? rows.length - shown.length : 0
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {shown.map((row) => (
        <PaperRow key={row.id} paper={row} />
      ))}
      {remainder > 0 ? (
        <span
          style={{
            padding: '2px 6px',
            fontSize: 'var(--text-xs)',
            fontStyle: 'italic',
            color: 'var(--color-text-muted)',
          }}
        >
          +{remainder} more paper{remainder === 1 ? '' : 's'}
        </span>
      ) : null}
    </div>
  )
}

function Body({
  input,
  output,
  cap,
  maxHeight,
}: {
  input: ListPapersInput
  output: ListPapersOutput
  cap: number | null
  maxHeight: number
}) {
  const inner: ReactNode =
    output.papers.length === 0 ? (
      <span
        style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}
      >
        No papers
      </span>
    ) : (
      <div style={{ maxHeight, overflow: 'auto' }}>
        <PaperList rows={output.papers} cap={cap} />
      </div>
    )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <QueryHeader input={input} output={output} />
      {inner}
      <Footer output={output} />
    </div>
  )
}

function ExpandedBody({
  input,
  output,
}: {
  input: ListPapersInput
  output: ListPapersOutput
}) {
  const [showAll, setShowAll] = useState(false)
  const cap = showAll ? null : 15
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Body input={input} output={output} cap={cap} maxHeight={520} />
      {!showAll && output.papers.length > 15 ? (
        <button
          type="button"
          className="agent-card-btn"
          onClick={() => setShowAll(true)}
          style={{ fontSize: 'var(--text-xs)', alignSelf: 'flex-start' }}
        >
          Show all {output.papers.length}
        </button>
      ) : null}
    </div>
  )
}

// ─── Resolver ─────────────────────────────────────────────────────────

export const ListPapersPreview: ToolPreviewResolver = (step) => {
  const input = narrowInput(step.input)
  const output = narrowOutput(step.output)

  if (!output) {
    return {
      oneLiner: 'list_papers',
      compact: <Malformed />,
    }
  }

  const filterBits: string[] = []
  if (input.q) filterBits.push(input.q)
  if (input.tag) filterBits.push(`tag:${input.tag}`)
  if (input.year) filterBits.push(`year:${input.year}`)
  const filterLabel = filterBits.length > 0 ? ` · ${filterBits.join(' ')}` : ''
  const oneLiner = `${output.returned} / ${output.total} papers${filterLabel}`

  return {
    oneLiner,
    compact: <Body input={input} output={output} cap={3} maxHeight={240} />,
    expanded: <ExpandedBody input={input} output={output} />,
  }
}
