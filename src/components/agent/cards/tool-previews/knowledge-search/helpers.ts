// Phase 3b · knowledge_search preview — pure formatting helpers.
//
// Shared between the row card and the list — kept dependency-free so render
// components can import cheaply and the unit surface stays small.

export function truncate(text: string, cap: number): string {
  if (text.length <= cap) return text
  return `${text.slice(0, cap - 1)}…`
}

export function formatConfidence(c: number | undefined): string | null {
  if (c == null || !Number.isFinite(c)) return null
  const pct = Math.round(c * 100)
  return `${pct}%`
}
