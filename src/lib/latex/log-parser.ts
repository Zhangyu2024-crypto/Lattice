import type { LatexCompileError } from '../../types/latex'

// pdfTeX / XeTeX produce notoriously free-form logs. We target the handful
// of patterns that carry an actionable file:line:message tuple and group the
// rest under a generic 'unknown error' rather than silently dropping them.
//
// Patterns handled:
//   ! <msg>                       — fatal error; followed a few lines later
//     ... l.<N> <excerpt>           by an `l.N <context>` line we pair up
//   LaTeX Warning: ... on input line N.   — warning
//   LaTeX Font Warning: ...               — warning
//   Package <name> Warning: ...           — warning
//   Overfull \hbox ... at lines N--M      — badbox
//   Underfull \hbox ... at lines N--M     — badbox (skip by default; noisy)
//
// The BusyTeX pipeline concatenates per-command logs with `== LOG: ==` style
// separators (see busytex_pipeline.js:634). We scan the whole blob as one
// stream; source file attribution for multi-file projects is best-effort
// because pdftex only emits `(./chapters/intro.tex` style (-paren-open-
// filename) markers and nesting is sensitive to balancing — Phase B leaves
// `file: null` when unresolved and we fix it up in Phase C if needed.

export interface ParseResult {
  errors: LatexCompileError[]
  warnings: LatexCompileError[]
}

const ERROR_LINE_RE = /^!\s+(.+)$/
const ERROR_LINE_NUMBER_RE = /^l\.(\d+)\s+(.*)$/
const WARN_LATEX_RE =
  /^(?:LaTeX|Package|Class)(?: \S+)? (?:Font )?Warning: (.+?)(?: on input line (\d+))?\.?$/
const OVERFULL_RE = /^Overfull \\hbox.*at lines? (\d+)(?:--(\d+))?/

export function parseLatexLog(log: string): ParseResult {
  const errors: LatexCompileError[] = []
  const warnings: LatexCompileError[] = []
  if (!log) return { errors, warnings }

  const lines = log.split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const err = line.match(ERROR_LINE_RE)
    if (err) {
      // Look ahead for the `l.N ...` context. pdftex usually places it within
      // 8 lines of the `!` banner. Capture an excerpt from both the l.N line
      // and the following line (often the "arrow" pointing at the offending
      // token).
      let lineNo: number | null = null
      let excerpt = ''
      for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
        const m = lines[j].match(ERROR_LINE_NUMBER_RE)
        if (m) {
          lineNo = parseInt(m[1], 10)
          const lead = m[2] ?? ''
          const follow = lines[j + 1] ?? ''
          excerpt = [lead, follow].filter(Boolean).join('\n').trim()
          break
        }
      }
      errors.push({
        file: null,
        line: lineNo,
        severity: 'error',
        message: err[1].trim(),
        excerpt: excerpt || undefined,
      })
      continue
    }

    const warn = line.match(WARN_LATEX_RE)
    if (warn) {
      warnings.push({
        file: null,
        line: warn[2] ? parseInt(warn[2], 10) : null,
        severity: 'warning',
        message: warn[1].trim(),
      })
      continue
    }

    const overfull = line.match(OVERFULL_RE)
    if (overfull) {
      warnings.push({
        file: null,
        line: parseInt(overfull[1], 10),
        severity: 'badbox',
        message: line.trim(),
      })
      continue
    }
  }

  return { errors, warnings }
}
