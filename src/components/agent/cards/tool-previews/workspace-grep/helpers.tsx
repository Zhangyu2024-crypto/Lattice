// Phase 3a · workspace_grep preview — pure helpers.
//
// Path + grouping + match-highlighting helpers. Dependency-free aside from
// React for the highlight renderer so components can import cheaply.

import type { ReactNode } from 'react'
import type { GrepMatch } from './types'

export function basename(relPath: string): string {
  const segs = relPath.split('/')
  return segs[segs.length - 1] || relPath
}

export function groupByFile(matches: GrepMatch[]): Array<[string, GrepMatch[]]> {
  const bucket = new Map<string, GrepMatch[]>()
  for (const m of matches) {
    const list = bucket.get(m.file)
    if (list) list.push(m)
    else bucket.set(m.file, [m])
  }
  return Array.from(bucket.entries())
}

/** Build a regex mirroring the tool's semantics (JS source + optional `i`
 *  flag). If the pattern is invalid we bail out to literal-string matching
 *  so the highlight logic still renders something rather than throwing. */
export function compileHighlightRegex(
  pattern: string,
  caseInsensitive: boolean,
): RegExp | null {
  try {
    return new RegExp(pattern, caseInsensitive ? 'gi' : 'g')
  } catch {
    return null
  }
}

export function highlightLine(
  text: string,
  re: RegExp | null,
  pattern: string,
  caseInsensitive: boolean,
): ReactNode {
  if (!re) {
    // Literal fallback when the regex didn't compile.
    const needle = caseInsensitive ? pattern.toLowerCase() : pattern
    const hay = caseInsensitive ? text.toLowerCase() : text
    const idx = hay.indexOf(needle)
    if (idx < 0 || needle.length === 0) return text
    return (
      <>
        {text.slice(0, idx)}
        <mark
          style={{
            background: 'rgba(255, 213, 89, 0.3)',
            color: 'inherit',
            borderRadius: 2,
            padding: '0 1px',
          }}
        >
          {text.slice(idx, idx + needle.length)}
        </mark>
        {text.slice(idx + needle.length)}
      </>
    )
  }
  const out: ReactNode[] = []
  let cursor = 0
  // Reset lastIndex so stale state from a prior invocation doesn't skip
  // the first character on the next line.
  re.lastIndex = 0
  let match: RegExpExecArray | null
  let guard = 0
  while ((match = re.exec(text)) !== null && guard++ < 100) {
    const start = match.index
    const end = start + match[0].length
    if (start > cursor) out.push(text.slice(cursor, start))
    out.push(
      <mark
        key={`${start}-${end}`}
        style={{
          background: 'rgba(255, 213, 89, 0.3)',
          color: 'inherit',
          borderRadius: 2,
          padding: '0 1px',
        }}
      >
        {text.slice(start, end)}
      </mark>,
    )
    cursor = end
    // A zero-width match would otherwise trap us in an infinite loop.
    if (match[0].length === 0) re.lastIndex += 1
  }
  if (cursor < text.length) out.push(text.slice(cursor))
  return out.length === 0 ? text : <>{out}</>
}
