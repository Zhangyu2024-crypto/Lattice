// Phase 3b · literature_search preview — query chip + diagnostic chips.
//
// Header row that shows the original query, the optional limit, the tool's
// wall-clock duration, and per-source diagnostic pills (openalex / arxiv
// ok count + error tooltip).

import { formatDuration } from './helpers'
import type {
  LitDiagnostic,
  LitSearchInput,
  LitSearchSuccess,
} from './types'

export function QueryHeader({
  input,
  output,
}: {
  input: LitSearchInput | null
  output: LitSearchSuccess
}) {
  const duration = formatDuration(output.durationMs)
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
      <span style={{ color: 'var(--color-text-muted)' }}>query</span>
      <code
        style={{
          fontFamily: 'var(--font-sans)',
          background: 'rgba(0, 0, 0, 0.25)',
          padding: '1px 5px',
          borderRadius: 3,
          color: 'var(--color-text-primary)',
          border: '1px solid var(--color-border)',
          maxWidth: '60%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={input?.query ?? output.query}
      >
        {input?.query ?? output.query}
      </code>
      {input?.limit != null ? (
        <span
          style={{
            fontSize: 'var(--text-xxs)',
            padding: '1px 5px',
            border: '1px solid var(--color-border)',
            borderRadius: 3,
            color: 'var(--color-text-muted)',
          }}
        >
          limit {input.limit}
        </span>
      ) : null}
      {duration ? (
        <span
          style={{
            fontSize: 'var(--text-xxs)',
            padding: '1px 5px',
            border: '1px solid var(--color-border)',
            borderRadius: 3,
            color: 'var(--color-text-muted)',
          }}
        >
          {duration}
        </span>
      ) : null}
      {output.diagnostics ? (
        <DiagnosticChips diagnostics={output.diagnostics} />
      ) : null}
    </div>
  )
}

function DiagnosticChips({
  diagnostics,
}: {
  diagnostics: NonNullable<LitSearchSuccess['diagnostics']>
}) {
  const rows: Array<{ name: string; diag: LitDiagnostic | undefined }> = [
    { name: 'openalex', diag: diagnostics.openalex },
    { name: 'arxiv', diag: diagnostics.arxiv },
  ]
  return (
    <>
      {rows.map(({ name, diag }) => {
        if (!diag) return null
        const bg = diag.ok
          ? 'rgba(50, 200, 100, 0.12)'
          : 'rgba(255, 100, 100, 0.12)'
        return (
          <span
            key={name}
            title={diag.error ?? `${diag.count} rows`}
            style={{
              fontSize: 'var(--text-xxs)',
              padding: '1px 5px',
              borderRadius: 3,
              background: bg,
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-muted)',
              fontFamily: 'var(--font-sans)',
            }}
          >
            {name}: {diag.count}
          </span>
        )
      })}
    </>
  )
}
