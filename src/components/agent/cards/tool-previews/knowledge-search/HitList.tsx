// Phase 3b · knowledge_search preview — capped list of hit cards.
//
// Compact/expanded variants both render the same list — the cap differs
// (3 rows compact, up to 12 or unbounded expanded). Renders a "+N more"
// trailer when the cap truncates the list.

import { ResultRow } from './ResultRow'
import type { Hit } from './types'

export function HitList({ hits, cap }: { hits: Hit[]; cap: number | null }) {
  const shown = cap != null ? hits.slice(0, cap) : hits
  const remainder = cap != null ? hits.length - shown.length : 0
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      {shown.map((h, i) => (
        <ResultRow key={`${h.chainId}-${i}`} hit={h} />
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
          +{remainder} more hit{remainder === 1 ? '' : 's'}
        </span>
      ) : null}
    </div>
  )
}
