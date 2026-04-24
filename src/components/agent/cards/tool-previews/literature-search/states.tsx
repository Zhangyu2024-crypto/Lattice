// Phase 3b · literature_search preview — footer + malformed + error states.
//
// Three tiny leaf components: the success footer (result count + total),
// the "malformed output" placeholder for unparseable tool results, and the
// error block shown when the tool reports ok=false.

import type { LitSearchSuccess } from './types'

export function Footer({ output }: { output: LitSearchSuccess }) {
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
        {output.results.length} result{output.results.length === 1 ? '' : 's'}
      </span>
      {output.count !== output.results.length ? (
        <span>(total {output.count})</span>
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

export function ErrorBlock({ message }: { message: string }) {
  return (
    <div
      style={{
        fontSize: 'var(--text-xs)',
        padding: '6px 8px',
        borderRadius: 4,
        background: 'rgba(255, 100, 100, 0.1)',
        border: '1px solid rgba(255, 100, 100, 0.35)',
        color: 'var(--color-text-primary)',
      }}
    >
      {message}
    </div>
  )
}
