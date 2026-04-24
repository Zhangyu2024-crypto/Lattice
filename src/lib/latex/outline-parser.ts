// Regex-based TeX heading extractor. Scans the source of a LaTeX file
// for \section, \subsection, \subsubsection commands and returns a flat
// outline array that the LatexDocumentCard can use to populate the
// outline pane + feed to AI context prompts.

import type { LatexOutlineEntry } from '../../types/latex'

const HEADING_RE =
  /\\(section|subsection|subsubsection)\*?\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g

const LEVEL_MAP: Record<string, number> = {
  section: 1,
  subsection: 2,
  subsubsection: 3,
}

export function parseOutline(
  source: string,
  file = 'main.tex',
): LatexOutlineEntry[] {
  const entries: LatexOutlineEntry[] = []
  let match: RegExpExecArray | null
  HEADING_RE.lastIndex = 0
  while ((match = HEADING_RE.exec(source)) !== null) {
    const kind = match[1] as keyof typeof LEVEL_MAP
    const title = match[2].trim()
    if (!title) continue
    entries.push({
      file,
      level: LEVEL_MAP[kind] ?? 1,
      title,
      offset: match.index,
    })
  }
  return entries
}

export function outlineToText(entries: LatexOutlineEntry[]): string {
  return entries
    .map((e) => `${'  '.repeat(e.level - 1)}${e.title}`)
    .join('\n')
}
