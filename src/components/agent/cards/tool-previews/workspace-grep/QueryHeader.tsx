// Phase 3a · workspace_grep preview — query header row.
//
// Renders the query pattern, optional glob scope, and the "i" flag badge
// when the user asked for case-insensitive matching.

import type { GrepInput } from './types'

export function QueryHeader({ input }: { input: GrepInput }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 'var(--text-xs)',
      }}
    >
      <span style={{ color: 'var(--color-text-muted)' }}>query</span>
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
        {input.pattern}
      </code>
      {input.glob ? (
        <>
          <span style={{ color: 'var(--color-text-muted)' }}>in</span>
          <code
            style={{
              fontFamily: 'var(--font-sans)',
              color: 'var(--color-text-muted)',
            }}
          >
            {input.glob}
          </code>
        </>
      ) : null}
      {input.caseInsensitive ? (
        <span
          style={{
            fontSize: "var(--text-xxs)",
            padding: '1px 5px',
            border: '1px solid var(--color-border)',
            borderRadius: 3,
            color: 'var(--color-text-muted)',
          }}
        >
          i
        </span>
      ) : null}
    </div>
  )
}
