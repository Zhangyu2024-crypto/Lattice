// Phase A2 — inline approval editor for the `latex_edit_selection` tool.
//
// Two-column diff: left pane is the read-only "before" span; right pane is
// an editable textarea seeded with the LLM's "after". Every keystroke
// publishes the edited-output envelope through `onChange` so the card's
// Approve button sends the current buffer to the LLM / patch applier.
//
// Compact on purpose — it sits between the AgentCard body and the
// Approve / Reject row, so vertical real estate is scarce.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { TaskStep } from '../../../../types/session'
import type {
  LatexEditSelectionOutput,
  SelectionVerb,
} from '../../../../lib/agent-tools/latex-selection'

const VERB_LABEL: Record<SelectionVerb, string> = {
  rewrite: 'Rewrite',
  continue: 'Continue',
  fix: 'Fix',
  polish: 'Polish',
}

function parseOutput(output: unknown): LatexEditSelectionOutput | null {
  if (!output || typeof output !== 'object') return null
  const c = output as Partial<LatexEditSelectionOutput>
  if (typeof c.artifactId !== 'string') return null
  if (typeof c.file !== 'string') return null
  if (typeof c.from !== 'number' || typeof c.to !== 'number') return null
  if (typeof c.before !== 'string' || typeof c.after !== 'string') return null
  if (c.verb !== 'rewrite' && c.verb !== 'continue' && c.verb !== 'fix' && c.verb !== 'polish') {
    return null
  }
  return {
    artifactId: c.artifactId,
    file: c.file,
    from: c.from,
    to: c.to,
    verb: c.verb,
    before: c.before,
    after: c.after,
    summary: typeof c.summary === 'string' ? c.summary : '',
  }
}

interface Props {
  step: TaskStep
  onChange: (edited: unknown) => void
}

export default function LatexEditSelectionEditor({ step, onChange }: Props) {
  const parsed = useMemo(() => parseOutput(step.output), [step.output])

  // Local mirror of the right-pane buffer. Re-seeded when the tool output
  // identity changes (e.g. the LLM re-ran the tool after a rejection) but
  // never from unrelated parent re-renders, so an in-flight edit survives.
  const [after, setAfter] = useState<string>(() => parsed?.after ?? '')
  const seededForOutputRef = useRef<unknown>(null)
  useEffect(() => {
    if (!parsed) return
    if (seededForOutputRef.current === step.output) return
    seededForOutputRef.current = step.output
    setAfter(parsed.after)
  }, [step.output, parsed])

  // Publish the seeded buffer on mount so AgentCard's editedOutput reflects
  // the current `after` even if the user approves without typing. Without
  // this the orchestrator would fall through to the raw tool output — same
  // content, but the intent of "edited" stays consistent.
  const publishRef = useRef(onChange)
  publishRef.current = onChange
  useEffect(() => {
    if (!parsed) return
    publishRef.current({ ...parsed, after })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const publish = (next: string) => {
    setAfter(next)
    if (!parsed) {
      onChange({ after: next })
      return
    }
    onChange({ ...parsed, after: next })
  }

  if (!parsed) {
    return (
      <div className="tool-approval-editor-empty">
        Output not in the expected shape; approve to use as-is or reject.
      </div>
    )
  }

  const beforeLines = parsed.before.split('\n').length
  const afterLines = after.split('\n').length
  const delta = after.length - parsed.before.length
  const deltaLabel = delta === 0 ? '±0' : delta > 0 ? `+${delta}` : `${delta}`

  return (
    <div className="tool-approval-editor tool-approval-editor-latex-edit-selection">
      <div className="tool-approval-editor-meta">
        <span className="tool-approval-editor-title">
          {VERB_LABEL[parsed.verb]} · {parsed.file}
        </span>
        <span className="tool-approval-editor-meta-spacer" />
        <span className="tool-approval-editor-meta-stat">
          {parsed.from}–{parsed.to}
        </span>
        <span className="tool-approval-editor-meta-stat">{deltaLabel} chars</span>
      </div>
      <div className="latex-edit-selection-diff">
        <div className="latex-edit-selection-pane">
          <div className="latex-edit-selection-pane-label">
            Before ({beforeLines} line{beforeLines === 1 ? '' : 's'})
          </div>
          <pre className="latex-edit-selection-before">{parsed.before}</pre>
        </div>
        <div className="latex-edit-selection-pane">
          <div className="latex-edit-selection-pane-label">
            After ({afterLines} line{afterLines === 1 ? '' : 's'})
          </div>
          <textarea
            className="latex-edit-selection-after"
            value={after}
            spellCheck={false}
            onChange={(e) => publish(e.target.value)}
          />
        </div>
      </div>
    </div>
  )
}
