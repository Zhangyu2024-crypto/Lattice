// Phase A3 — inline approval editor for `latex_insert_figure_from_artifact`.
//
// Lets the user tweak the proposed snippet (LaTeX table / figure / tabular)
// before it's inserted. Approve invokes the applier-registry which writes
// the snippet into the LaTeX artifact at the chosen insertion point.

import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText } from 'lucide-react'
import type { TaskStep } from '../../../../types/session'

interface FigureOutput {
  success: true
  artifactId: string
  insertFile: string
  insertAt: number
  snippet: string
  sourceKind: string
  summary: string
}

function parseOutput(output: unknown): FigureOutput | null {
  if (!output || typeof output !== 'object') return null
  const c = output as Partial<FigureOutput>
  if (c.success !== true) return null
  if (typeof c.artifactId !== 'string') return null
  if (typeof c.insertFile !== 'string') return null
  if (typeof c.insertAt !== 'number') return null
  if (typeof c.snippet !== 'string') return null
  if (typeof c.sourceKind !== 'string') return null
  return {
    success: true,
    artifactId: c.artifactId,
    insertFile: c.insertFile,
    insertAt: c.insertAt,
    snippet: c.snippet,
    sourceKind: c.sourceKind,
    summary: typeof c.summary === 'string' ? c.summary : '',
  }
}

interface Props {
  step: TaskStep
  onChange: (edited: unknown) => void
}

export default function LatexFigureEditor({ step, onChange }: Props) {
  const parsed = useMemo(() => parseOutput(step.output), [step.output])
  const [snippet, setSnippet] = useState<string>(() => parsed?.snippet ?? '')
  const seededRef = useRef<unknown>(null)
  useEffect(() => {
    if (!parsed) return
    if (seededRef.current === step.output) return
    seededRef.current = step.output
    setSnippet(parsed.snippet)
  }, [step.output, parsed])

  const publishRef = useRef(onChange)
  publishRef.current = onChange
  useEffect(() => {
    if (!parsed) return
    publishRef.current({ ...parsed, snippet })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const publish = (next: string) => {
    setSnippet(next)
    if (!parsed) {
      onChange({ snippet: next })
      return
    }
    onChange({ ...parsed, snippet: next })
  }

  if (!parsed) {
    return (
      <div className="tool-approval-editor-empty">
        Output not in the expected shape; approve to use as-is or reject.
      </div>
    )
  }

  const lines = snippet.split('\n').length

  return (
    <div className="tool-approval-editor tool-approval-editor-latex-figure">
      <div className="tool-approval-editor-meta">
        <FileText size={12} aria-hidden />
        <span className="tool-approval-editor-title">
          {parsed.sourceKind} → {parsed.insertFile}@{parsed.insertAt}
        </span>
        <span className="tool-approval-editor-meta-spacer" />
        <span className="tool-approval-editor-meta-stat">
          {lines} line{lines === 1 ? '' : 's'}
        </span>
      </div>
      <textarea
        className="latex-figure-snippet"
        value={snippet}
        spellCheck={false}
        onChange={(e) => publish(e.target.value)}
      />
    </div>
  )
}
