// Phase A3 — inline approval editor for `latex_fix_compile_error`.
//
// Shows the error message + file:fromLine-toLine anchor, plus an editable
// replacement textarea. Approve applies the patch via the applier-registry.

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import type { TaskStep } from '../../../../types/session'

interface FixOutput {
  success: true
  artifactId: string
  file: string
  fromLine: number
  toLine: number
  replacement: string
  errorMessage: string
  summary: string
}

function parseOutput(output: unknown): FixOutput | null {
  if (!output || typeof output !== 'object') return null
  const c = output as Partial<FixOutput>
  if (c.success !== true) return null
  if (typeof c.artifactId !== 'string') return null
  if (typeof c.file !== 'string') return null
  if (typeof c.fromLine !== 'number' || typeof c.toLine !== 'number') return null
  if (typeof c.replacement !== 'string') return null
  if (typeof c.errorMessage !== 'string') return null
  return {
    success: true,
    artifactId: c.artifactId,
    file: c.file,
    fromLine: c.fromLine,
    toLine: c.toLine,
    replacement: c.replacement,
    errorMessage: c.errorMessage,
    summary: typeof c.summary === 'string' ? c.summary : '',
  }
}

interface Props {
  step: TaskStep
  onChange: (edited: unknown) => void
}

export default function LatexFixCompileErrorEditor({ step, onChange }: Props) {
  const parsed = useMemo(() => parseOutput(step.output), [step.output])
  const [replacement, setReplacement] = useState<string>(
    () => parsed?.replacement ?? '',
  )
  const seededRef = useRef<unknown>(null)
  useEffect(() => {
    if (!parsed) return
    if (seededRef.current === step.output) return
    seededRef.current = step.output
    setReplacement(parsed.replacement)
  }, [step.output, parsed])

  const publishRef = useRef(onChange)
  publishRef.current = onChange
  useEffect(() => {
    if (!parsed) return
    publishRef.current({ ...parsed, replacement })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const publish = (next: string) => {
    setReplacement(next)
    if (!parsed) {
      onChange({ replacement: next })
      return
    }
    onChange({ ...parsed, replacement: next })
  }

  if (!parsed) {
    return (
      <div className="tool-approval-editor-empty">
        Output not in the expected shape; approve to use as-is or reject.
      </div>
    )
  }

  return (
    <div className="tool-approval-editor tool-approval-editor-latex-fix-compile-error">
      <div className="tool-approval-editor-meta">
        <AlertCircle size={12} aria-hidden />
        <span className="tool-approval-editor-title">
          {parsed.file}:{parsed.fromLine}–{parsed.toLine}
        </span>
      </div>
      <div className="latex-fix-compile-error-message">{parsed.errorMessage}</div>
      <textarea
        className="latex-fix-compile-error-replacement"
        value={replacement}
        spellCheck={false}
        onChange={(e) => publish(e.target.value)}
      />
    </div>
  )
}
