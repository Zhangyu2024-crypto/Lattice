import type { ReactNode } from 'react'

/** Derive a human-readable category from the command id prefix. */
export function categoryOf(id: string): string | null {
  if (id.startsWith('demo-') || id === 'demo') return 'Demo'
  if (id.startsWith('pro-')) return 'Pro'
  if (id.startsWith('domain-')) return 'Analysis'
  if (id.startsWith('dev-')) return 'Dev'
  if (
    id === 'new-session' ||
    id === 'open' ||
    id === 'sidebar' ||
    id === 'chat' ||
    id === 'export' ||
    id === 'export-zip' ||
    id === 'worker-test' ||
    id === 'open-library' ||
    id === 'open-knowledge' ||
    id === 'start-research'
  ) {
    return 'Settings'
  }
  return null
}

/**
 * Render a command label with matched substring wrapped in <mark>.
 * Uses a simple case-insensitive substring search — the palette is small
 * enough that a fuzzy matcher would be premature, and users typically
 * type prefixes of the visible label.
 */
export function renderLabelWithHighlight(
  label: string,
  query: string,
): ReactNode {
  if (!query) return label
  const idx = label.toLowerCase().indexOf(query.toLowerCase())
  if (idx < 0) return label
  const before = label.slice(0, idx)
  const match = label.slice(idx, idx + query.length)
  const after = label.slice(idx + query.length)
  return (
    <>
      {before}
      <mark>{match}</mark>
      {after}
    </>
  )
}
