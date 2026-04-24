import type { UsageAggregate } from '../../../../types/llm'

// ─── Shared constants ───────────────────────────────────────────────────

export const WARN_PCT_OPTIONS = [0.5, 0.7, 0.8, 0.9] as const

export const EMPTY_AGG: UsageAggregate = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUSD: 0,
}

// Progress-bar fill colour mapping — kept alongside the other budget
// constants so tweaking thresholds doesn't require diving into shared.tsx.
export function colorForPct(pct: number, limit: number | null): string {
  if (limit === null) return 'var(--color-text-muted)'
  if (pct < 0.5) return 'var(--color-green)'
  if (pct < 0.8) return 'var(--color-accent)'
  if (pct < 0.95) return 'var(--color-yellow)'
  return 'var(--color-red)'
}
