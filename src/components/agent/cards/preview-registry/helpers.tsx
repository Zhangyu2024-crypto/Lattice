// Shared preview-building helpers used by the artifact-kind fallback and
// the per-tool resolvers registered under `tool-previews/register-*`.
//
// These were extracted from the original `preview-registry.tsx` without
// any behavior change — they're pure UI primitives for rendering the
// small list rows that preview blocks commonly need.

import type { ReactNode } from 'react'

/** Wrap a pre-built array of `<li>` nodes in the card's shared list
 *  element. Kept as a thin helper so every resolver emits the exact same
 *  class name — the CSS lives with AgentCard. */
export function compactList(items: ReactNode[]): ReactNode {
  return <ul className="agent-card-list">{items}</ul>
}

/** Build one of the two-column preview rows (main on the left, optional
 *  meta on the right). `key` is surfaced so callers can stably identify
 *  rows built inside a `map`. */
export function listRow(
  main: ReactNode,
  meta?: ReactNode,
  key?: string | number,
): ReactNode {
  return (
    <li key={key}>
      <span className="agent-card-row-main">{main}</span>
      {meta !== undefined ? (
        <span className="agent-card-row-meta">{meta}</span>
      ) : null}
    </li>
  )
}

/** Heuristic guard used by the generic fallback: is this string the raw
 *  JSON output from the orchestrator's `summarizeToolOutput`? We don't
 *  want those blobs leaking into the card's one-line summary. */
export function looksLikeJsonLiteral(value: string): boolean {
  const trimmed = value.trimStart()
  if (trimmed.length === 0) return false
  const first = trimmed[0]
  return first === '{' || first === '[' || first === '"'
}
