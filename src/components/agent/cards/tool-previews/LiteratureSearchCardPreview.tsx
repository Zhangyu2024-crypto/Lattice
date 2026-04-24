// Phase 3b · literature_search preview card.
//
// Renders the OpenAlex + arXiv result rows the tool brings back — one paper
// per card with a clamped abstract that expands on click. The tool-level
// result already deduplicates + ranks, so we render the rows as-is. There's
// no shared PaperCard component we can reuse (library/PaperCard.tsx does
// not exist; `PaperArtifactCard` renders a session-local artifact, not a
// raw search row), so this is a lightweight purpose-built card.
//
// A "Import to library" affordance is offered but intentionally unwired:
// there is no library-import event today. Clicking it emits a warn toast
// so the surface is obvious, matching the Phase 3b spec.
//
// The card was split into ./literature-search/* helpers after it crossed
// 600 lines — this file keeps the resolver, the registry-facing export,
// and the top-level Body layout so the preview-registry wiring stays at
// the same import path.

import type { ReactNode } from 'react'
import type { ToolPreviewResolver } from '../preview-registry'
import { formatDuration } from './literature-search/helpers'
import { PaperList } from './literature-search/PaperList'
import { QueryHeader } from './literature-search/QueryHeader'
import {
  ErrorBlock,
  Footer,
  Malformed,
} from './literature-search/states'
import {
  narrowInput,
  narrowOutput,
  type LitSearchInput,
  type LitSearchSuccess,
} from './literature-search/types'

function Body({
  input,
  output,
  cap,
  maxHeight,
}: {
  input: LitSearchInput | null
  output: LitSearchSuccess
  cap: number | null
  maxHeight: number
}) {
  const inner: ReactNode =
    output.results.length === 0 ? (
      <span
        style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}
      >
        No results
      </span>
    ) : (
      <div style={{ maxHeight, overflow: 'auto' }}>
        <PaperList rows={output.results} cap={cap} />
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

export const LiteratureSearchPreview: ToolPreviewResolver = (step) => {
  const input = narrowInput(step.input)
  const output = narrowOutput(step.output)

  if (!output) {
    return {
      oneLiner: input ? `literature_search · ${input.query}` : 'literature_search',
      compact: <Malformed />,
    }
  }

  if (!output.ok) {
    return {
      oneLiner: `literature_search · failed${input ? ` · ${input.query}` : ''}`,
      compact: <ErrorBlock message={output.error} />,
    }
  }

  const duration = formatDuration(output.durationMs)
  const oneLiner = `${output.count} paper${output.count === 1 ? '' : 's'}${
    duration ? ` · ${duration}` : ''
  }`

  return {
    oneLiner,
    compact: <Body input={input} output={output} cap={3} maxHeight={260} />,
    expanded: <Body input={input} output={output} cap={null} maxHeight={520} />,
  }
}
