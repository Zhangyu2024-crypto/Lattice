// Phase 3b · list_papers preview — footer + malformed placeholder.
//
// Two tiny leaf components: the footer shown beneath the paper list with
// the returned / total count and a "truncated" pill when the backend
// clipped results, and the muted "malformed output" placeholder used when
// the tool result cannot be narrowed.

import type { ListPapersOutput } from './types'

export function Footer({ output }: { output: ListPapersOutput }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 'var(--text-xs)',
        color: 'var(--color-text-muted)',
      }}
    >
      <span>
        {output.returned} / {output.total} shown
      </span>
      {output.total > output.returned ? (
        <span
          style={{
            fontSize: "var(--text-xxs)",
            padding: '1px 5px',
            borderRadius: 3,
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-muted)',
          }}
        >
          truncated
        </span>
      ) : null}
    </div>
  )
}

export function Malformed() {
  return (
    <div
      style={{
        fontSize: 'var(--text-xs)',
        color: 'var(--color-text-muted)',
        fontStyle: 'italic',
      }}
    >
      malformed output
    </div>
  )
}
