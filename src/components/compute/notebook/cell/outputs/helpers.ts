// Pure formatters shared by cell-output renderers.
//
// Kept separate from the React components so they can be unit-tested
// (or reused by the collapsed-input header) without pulling in JSX.

/** Short one-line preview of the code for the "input collapsed" peek. */
export function firstLineSnippet(code: string): string {
  const head = (code ?? '').split('\n').find((l) => l.trim().length > 0) ?? ''
  const trimmed = head.trim()
  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed || 'empty'
}
