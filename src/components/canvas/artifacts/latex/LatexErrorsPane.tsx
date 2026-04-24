import { AlertCircle, AlertTriangle, Info, Lightbulb } from 'lucide-react'
import type { LatexCompileError } from '../../../../types/latex'

interface Props {
  errors: LatexCompileError[]
  warnings: LatexCompileError[]
  logTail: string
}

// BusyTeX only ships pdfTeX + bibtex8 — no biber, no shell-escape. When
// compiler output trips any of these sentinels we surface an actionable
// hint above the raw error list so users know to switch to natbib rather
// than chase a "biblatex.sty not found" rabbit hole.
const ENGINE_HINT_PATTERNS = [
  /biber/i,
  /biblatex\.sty/i,
  /\\write18/i,
  /shell-?escape/i,
]

function hasEngineLimitationSignal(
  errors: LatexCompileError[],
  warnings: LatexCompileError[],
  logTail: string,
): boolean {
  const haystack = [
    ...errors.map((e) => `${e.message} ${e.excerpt ?? ''}`),
    ...warnings.map((w) => `${w.message} ${w.excerpt ?? ''}`),
    logTail,
  ].join('\n')
  return ENGINE_HINT_PATTERNS.some((re) => re.test(haystack))
}

export default function LatexErrorsPane({ errors, warnings, logTail }: Props) {
  const anything = errors.length + warnings.length > 0
  const showEngineHint = hasEngineLimitationSignal(errors, warnings, logTail)
  return (
    <div className="latex-errors-root">
      {showEngineHint ? <EngineHintBanner /> : null}
      {anything ? (
        <ul className="latex-errors-list" role="list">
          {errors.map((e, i) => (
            <ErrorRow key={`e-${i}`} err={e} />
          ))}
          {warnings.map((w, i) => (
            <ErrorRow key={`w-${i}`} err={w} />
          ))}
        </ul>
      ) : (
        <div className="latex-errors-empty">
          No errors or warnings from the last compile.
        </div>
      )}
      {logTail ? (
        <details className="latex-errors-log">
          <summary>Raw log (last 8KB)</summary>
          <pre>{logTail.slice(-8192)}</pre>
        </details>
      ) : null}
    </div>
  )
}

function EngineHintBanner() {
  return (
    <div className="latex-errors-engine-hint" role="note">
      <Lightbulb size={14} aria-hidden />
      <div className="latex-errors-engine-hint-body">
        <div className="latex-errors-engine-hint-title">
          Engine limitation
        </div>
        <div className="latex-errors-engine-hint-text">
          BusyTeX includes <code>bibtex8</code> (not <code>biber</code>) and has
          no <code>\write18</code>/shell-escape. For citations, use{' '}
          <code>\usepackage[numbers]{'{natbib}'}</code> +{' '}
          <code>\bibliographystyle{'{plain}'}</code> +{' '}
          <code>\bibliography{'{refs}'}</code> (without the <code>.bib</code>{' '}
          extension).
        </div>
      </div>
    </div>
  )
}

function ErrorRow({ err }: { err: LatexCompileError }) {
  const Icon =
    err.severity === 'error'
      ? AlertCircle
      : err.severity === 'warning'
        ? AlertTriangle
        : Info
  const cls =
    err.severity === 'error'
      ? 'latex-errors-row is-error'
      : err.severity === 'warning'
        ? 'latex-errors-row is-warn'
        : 'latex-errors-row is-info'
  return (
    <li className={cls}>
      <Icon size={12} aria-hidden />
      <div className="latex-errors-row-main">
        <div className="latex-errors-row-message">
          {err.message}
          {err.line != null ? (
            <span className="latex-errors-row-loc">
              {' '}
              — line {err.line}
              {err.file ? ` in ${err.file}` : ''}
            </span>
          ) : null}
        </div>
        {err.excerpt ? (
          <pre className="latex-errors-row-excerpt">{err.excerpt}</pre>
        ) : null}
      </div>
    </li>
  )
}
