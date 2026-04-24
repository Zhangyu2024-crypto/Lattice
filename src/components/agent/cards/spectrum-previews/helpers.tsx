// Shared helpers for the spectrum / XRD / XPS / Raman preview resolvers.
// Extracted from `register-spectrum-previews.tsx` without behavior change
// so the larger bespoke resolvers (xrd_search_phases, raman_identify, …)
// can live in their own files.

import type { ReactNode } from 'react'

/** A thin 60×4 bar that visualises a 0–1 confidence score next to a row.
 *  Used by candidate lists that need a quick visual rank signal. Kept
 *  purely presentational — the bar is aria-hidden because the numeric
 *  score is already shown adjacent. */
export function confidenceBar(score: number | undefined): ReactNode {
  const pct = Math.max(0, Math.min(1, score ?? 0)) * 100
  return (
    <span
      className="agent-card-confbar"
      style={{
        display: 'inline-block',
        width: 60,
        height: 4,
        background: '#2A2A2A',
        borderRadius: 2,
        position: 'relative',
        marginLeft: 6,
        verticalAlign: 'middle',
      }}
      aria-hidden
    >
      <span
        style={{
          display: 'block',
          width: `${pct}%`,
          height: '100%',
          background: '#6EA8FE',
          borderRadius: 2,
        }}
      />
    </span>
  )
}
