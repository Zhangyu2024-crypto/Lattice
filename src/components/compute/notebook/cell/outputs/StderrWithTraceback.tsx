// Stderr with Python traceback highlighting.
//
// Runs a conservative regex pass over stderr text to dim everything
// before the last "Traceback (most recent call last):" marker, and to
// pick out the `File "<path>", line <N>, in <context>` anchors for
// emphasis. The rest flows through as normal text, so non-Python
// stderr (LAMMPS / CP2K / bash) renders identically to before. Cheap
// memoized split — for a 50-line traceback this is sub-millisecond.

import { useMemo } from 'react'

const TRACEBACK_START = /^Traceback \(most recent call last\):$/m
const TRACEBACK_FILE_LINE =
  /^(\s*)File "([^"]+)", line (\d+)(?:, in (.+))?$/

export function StderrWithTraceback({ text }: { text: string }) {
  const parts = useMemo(() => {
    if (!text) return null
    const match = TRACEBACK_START.exec(text)
    // If no Python traceback, render as-is so LAMMPS / CP2K / bash
    // stderr still works exactly the same.
    if (!match) return null
    const before = text.slice(0, match.index)
    const tracebackBody = text.slice(match.index)
    const lines = tracebackBody.split('\n')
    return { before, lines }
  }, [text])

  if (!parts) {
    // No traceback → render the raw text; callers put us inside a
    // `<pre>` that already preserves whitespace + newlines.
    return <>{text}</>
  }
  return (
    <>
      {parts.before && (
        <span className="compute-nb-traceback-before">{parts.before}</span>
      )}
      {parts.lines.map((line, i) => {
        const fileMatch = TRACEBACK_FILE_LINE.exec(line)
        if (fileMatch) {
          const [, indent, path, lineNo, ctx] = fileMatch
          return (
            <span key={i} className="compute-nb-traceback-line">
              {indent}File "
              <span className="compute-nb-traceback-path">{path}</span>
              ", line{' '}
              <span className="compute-nb-traceback-lineno">{lineNo}</span>
              {ctx && <>, in {ctx}</>}
              {'\n'}
            </span>
          )
        }
        // Last line is usually the error type + message — give it the
        // "error head" highlight if it looks like a `SomeError: msg`.
        if (/^[A-Z][A-Za-z0-9_.]*(?:Error|Exception|Warning):/.test(line)) {
          return (
            <span key={i} className="compute-nb-traceback-error-head">
              {line}
              {'\n'}
            </span>
          )
        }
        return (
          <span key={i}>
            {line}
            {'\n'}
          </span>
        )
      })}
    </>
  )
}
