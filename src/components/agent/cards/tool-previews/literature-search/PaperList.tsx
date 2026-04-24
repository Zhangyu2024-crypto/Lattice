// Phase 3b · literature_search preview — list of paper rows with cap.
//
// Compact/expanded variants both render the same list — the cap differs
// (3 rows compact, unbounded expanded). Renders a "+N more" trailer when
// the cap truncates the list.

import { PaperRow } from './PaperRow'
import type { LitPaperRow } from './types'

export function PaperList({
  rows,
  cap,
}: {
  rows: LitPaperRow[]
  cap: number | null
}) {
  const shown = cap != null ? rows.slice(0, cap) : rows
  const remainder = cap != null ? rows.length - shown.length : 0
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {shown.map((row) => (
        <PaperRow key={row.id} row={row} />
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
