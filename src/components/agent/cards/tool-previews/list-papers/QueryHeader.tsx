// Phase 3b · list_papers preview — header row with filter chips + counts.
//
// Shows the filter inputs (q / tag / year / collection) as labelled code
// chips, an optional sort chip, and the returned / total count pill on the
// right. When no filters are set we render a muted "(all papers)" label
// so an unfiltered browse stays distinguishable from a missing query.

import type { ListPapersInput, ListPapersOutput } from './types'

export function QueryHeader({
  input,
  output,
}: {
  input: ListPapersInput
  output: ListPapersOutput
}) {
  const filters: Array<{ key: string; label: string; value: string }> = []
  if (input.q) filters.push({ key: 'q', label: 'q', value: input.q })
  if (input.tag) filters.push({ key: 'tag', label: 'tag', value: input.tag })
  if (input.year) filters.push({ key: 'year', label: 'year', value: input.year })
  if (input.collection)
    filters.push({ key: 'col', label: 'collection', value: input.collection })
  const sortLabel =
    input.sort && input.order
      ? `${input.sort} ${input.order}`
      : input.sort
        ? input.sort
        : null
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 6,
        fontSize: 'var(--text-xs)',
      }}
    >
      {filters.length === 0 ? (
        <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
          (all papers)
        </span>
      ) : (
        filters.map((f) => (
          <span
            key={f.key}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <span style={{ color: 'var(--color-text-muted)' }}>{f.label}</span>
            <code
              style={{
                fontFamily: 'var(--font-sans)',
                background: 'rgba(0, 0, 0, 0.25)',
                padding: '1px 5px',
                borderRadius: 3,
                color: 'var(--color-text-primary)',
                border: '1px solid var(--color-border)',
              }}
            >
              {f.value}
            </code>
          </span>
        ))
      )}
      {sortLabel ? (
        <span
          style={{
            fontSize: "var(--text-xxs)",
            padding: '1px 5px',
            border: '1px solid var(--color-border)',
            borderRadius: 3,
            color: 'var(--color-text-muted)',
            fontFamily: 'var(--font-sans)',
          }}
        >
          {sortLabel}
        </span>
      ) : null}
      <span
        style={{
          fontSize: "var(--text-xxs)",
          padding: '1px 5px',
          borderRadius: 3,
          background: 'rgba(110, 168, 254, 0.12)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-muted)',
          fontFamily: 'var(--font-sans)',
        }}
      >
        {output.returned} / {output.total}
      </span>
    </div>
  )
}
