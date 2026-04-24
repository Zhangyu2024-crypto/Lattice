// Phase 3b · literature_search preview — pure formatting helpers.
//
// All string-manipulation helpers for the preview card. Kept dependency-free
// so render components can import cheaply and the unit surface stays small.

/** Split the comma-separated authors string the orchestrator hands us
 *  back into a trim list — the LLM-facing projection joined with ', '
 *  so a naive split is sufficient. */
export function splitAuthors(authors: string): string[] {
  if (!authors) return []
  return authors
    .split(/,\s*/)
    .map((a) => a.trim())
    .filter(Boolean)
}

export function formatAuthors(authors: string, cap: number): string {
  const parts = splitAuthors(authors)
  if (parts.length === 0) return '—'
  if (parts.length <= cap) return parts.join(', ')
  return `${parts.slice(0, cap).join(', ')}, … (+${parts.length - cap})`
}

export function truncate(text: string, cap: number): string {
  if (text.length <= cap) return text
  return `${text.slice(0, cap - 1)}…`
}

export function formatDuration(ms: number | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)} s`
}
