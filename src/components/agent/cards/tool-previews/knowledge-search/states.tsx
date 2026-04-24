// Phase 3b · knowledge_search preview — footer + malformed placeholder.
//
// Two small leaf components shared by compact and expanded views: the
// "shown / total" footer and the italic "malformed output" placeholder
// used when the tool result shape could not be narrowed.

export function Footer({ total, shown }: { total: number; shown: number }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginTop: 4,
        fontSize: 'var(--text-xs)',
        color: 'var(--color-text-muted)',
      }}
    >
      <span>
        {shown} / {total} hit{total === 1 ? '' : 's'} shown
      </span>
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
