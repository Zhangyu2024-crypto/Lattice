// Tiny fuzzy scorer for the `/` typeahead.
//
// We ported the *shape* of Claude Code's PromptInput matcher — exact wins
// over prefix wins over subsequence — but kept the implementation dep-free.
// At the ~10-60 command scale we expect, a straightforward scorer returning
// a single number per candidate is plenty; promote to a real library only
// if usage grows.
//
// Scoring, high → low:
//   exact name/alias ......... 1000
//   prefix of name ........... 700  - (name.length - query.length)
//   prefix of alias .......... 650  - (alias.length - query.length)
//   prefix of a word in name . 500  - gap penalty          (e.g. "rev" matches "review")
//   subsequence in name ...... 300  - 2*gaps                (gap = skipped chars between matches)
//   prefix of description .... 200  - (desc.length - query.length)/4
//   subsequence in desc ...... 100  - 2*gaps
//   no match ................. -Infinity (filtered out)
//
// Empty query returns 0 for every candidate — callers should preserve
// registry order in that case.

import type { Command } from './types'

export interface ScoredCommand {
  cmd: Command
  score: number
}

/** Score a single candidate against the query. Non-negative = included. */
export function scoreCommand(cmd: Command, rawQuery: string): number {
  const query = rawQuery.trim().toLowerCase()
  if (query === '') return 0

  const name = cmd.name.toLowerCase()
  const aliases = (cmd.aliases ?? []).map((a) => a.toLowerCase())
  const description = cmd.description.toLowerCase()

  if (name === query) return 1000
  for (const alias of aliases) if (alias === query) return 1000

  if (name.startsWith(query)) return 700 - (name.length - query.length)
  for (const alias of aliases) {
    if (alias.startsWith(query))
      return 650 - (alias.length - query.length)
  }

  // Word-boundary prefix inside name (e.g. "tab" matches "open-tab").
  const wordScore = scoreWordBoundary(name, query)
  if (wordScore > 0) return wordScore

  const nameSubseq = scoreSubsequence(name, query)
  if (nameSubseq > 0) return 300 - 2 * (name.length - nameSubseq)

  if (description.startsWith(query)) {
    return 200 - Math.floor((description.length - query.length) / 4)
  }

  const descSubseq = scoreSubsequence(description, query)
  if (descSubseq > 0) return 100 - 2 * (description.length - descSubseq)

  return Number.NEGATIVE_INFINITY
}

/**
 * Sort commands by descending score. Stable for ties (tie-break on
 * registry order). Commands that don't match the query at all are dropped.
 */
export function rankCommands(
  commands: readonly Command[],
  query: string,
): Command[] {
  if (query.trim() === '') return [...commands]
  const scored: Array<{ cmd: Command; score: number; idx: number }> = []
  commands.forEach((cmd, idx) => {
    const score = scoreCommand(cmd, query)
    if (score !== Number.NEGATIVE_INFINITY) scored.push({ cmd, score, idx })
  })
  scored.sort((a, b) => (b.score - a.score) || (a.idx - b.idx))
  return scored.map((s) => s.cmd)
}

// Returns a positive score when `query` is a contiguous prefix of any
// dash/underscore-delimited segment of `name`. "rev" against "open-review"
// matches the "review" segment.
function scoreWordBoundary(name: string, query: string): number {
  let score = 0
  for (const part of name.split(/[-_]/)) {
    if (part.startsWith(query)) {
      const candidate = 500 - (part.length - query.length)
      if (candidate > score) score = candidate
    }
  }
  return score
}

// Greedy subsequence match. Returns the number of matched characters when
// every character of `query` appears in order inside `haystack`; 0 when
// some character is missing. Used as a cheap substring-tolerant signal.
function scoreSubsequence(haystack: string, query: string): number {
  let hi = 0
  let matched = 0
  for (const q of query) {
    const found = haystack.indexOf(q, hi)
    if (found === -1) return 0
    matched++
    hi = found + 1
  }
  return matched
}
