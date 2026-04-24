// Phase 3b · list_papers preview — pure formatting helpers.
//
// Dependency-free string utilities shared by the list-papers row renderer.
// Kept separate so the view components stay render-only.

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
