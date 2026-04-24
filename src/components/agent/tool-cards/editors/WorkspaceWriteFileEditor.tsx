// Phase 5 — inline approval editor for the `workspace_write_file` tool.
//
// Renders the proposed file write as an editable textarea, with the prior
// file content (if any) tucked behind a `<details>` block for reference.
// Every keystroke publishes an updated `{ relPath, proposedContent,
// sizeBytes, existingContent }` envelope through `onChange`; the card's
// Approve button ships that latest value to the applier registry.
//
// Contract (pinned by the Phase 4 / Phase 5 split):
//
//   type WorkspaceWriteFileProposal = {
//     relPath: string
//     proposedContent: string
//     sizeBytes: number
//     existingContent: string | null  // null when the file is new
//   }
//
// Binary-safety guard: if the existing file is very large or looks
// non-printable we suppress the reference block entirely rather than
// dumping kilobytes of NULs into the DOM. The editable textarea still
// shows the LLM's proposed replacement so the user can confirm or tweak.

import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText } from 'lucide-react'
import type { TaskStep } from '../../../../types/session'

interface WorkspaceWriteFileProposal {
  relPath: string
  proposedContent: string
  sizeBytes: number
  existingContent: string | null
}

/** Narrow `step.output` into the pinned shape. Returns `null` when any
 *  required field is missing so the editor can render a polite
 *  "waiting for tool output" fallback instead of surfacing a crash. */
function parseOutput(output: unknown): WorkspaceWriteFileProposal | null {
  if (!output || typeof output !== 'object') return null
  const c = output as Partial<WorkspaceWriteFileProposal>
  if (typeof c.relPath !== 'string') return null
  if (typeof c.proposedContent !== 'string') return null
  // `existingContent` may be null by contract; anything else that isn't
  // a string is a shape violation.
  if (c.existingContent !== null && typeof c.existingContent !== 'string') {
    return null
  }
  const sizeBytes =
    typeof c.sizeBytes === 'number' && Number.isFinite(c.sizeBytes)
      ? c.sizeBytes
      : c.proposedContent.length
  return {
    relPath: c.relPath,
    proposedContent: c.proposedContent,
    sizeBytes,
    existingContent: c.existingContent ?? null,
  }
}

/** Human-readable byte size label. Mirrors the helper in
 *  `ComputeContainerControls` so the visual register stays consistent,
 *  but inlined here to avoid dragging a compute-specific import into
 *  this tiny editor. */
function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** Size threshold beyond which we refuse to render the existing-file
 *  reference block. 100 KB is well clear of a human-edited source file
 *  and keeps the DOM responsive on CPython-generated data dumps. */
const EXISTING_CONTENT_RENDER_LIMIT = 100_000

/** Quick heuristic for "this content looks binary". We sample a prefix
 *  and count bytes outside the printable / whitespace ASCII range; if
 *  more than ~10% of the sample is non-printable we bail. This is cheap
 *  and conservative — false negatives on UTF-8 text are fine (the
 *  textarea renders it), false positives merely hide the reference. */
function looksBinary(sample: string): boolean {
  if (!sample) return false
  const windowSize = Math.min(sample.length, 2048)
  let nonPrintable = 0
  for (let i = 0; i < windowSize; i++) {
    const code = sample.charCodeAt(i)
    // Tab, LF, CR, plus printable ASCII + any extended codepoint.
    if (code === 9 || code === 10 || code === 13) continue
    if (code >= 32) continue
    nonPrintable++
  }
  return nonPrintable / windowSize > 0.1
}

interface Props {
  step: TaskStep
  onChange: (edited: unknown) => void
}

export default function WorkspaceWriteFileEditor({ step, onChange }: Props) {
  const parsed = useMemo(() => parseOutput(step.output), [step.output])

  // Local mirror of the editable textarea. We only re-seed when the
  // underlying `step.output` identity changes (i.e. the LLM re-ran the
  // tool) — otherwise in-flight user edits would be clobbered by any
  // stale parent re-render.
  const [proposed, setProposed] = useState<string>(
    () => parsed?.proposedContent ?? '',
  )
  const seededRef = useRef<unknown>(null)
  useEffect(() => {
    if (!parsed) return
    if (seededRef.current === step.output) return
    seededRef.current = step.output
    setProposed(parsed.proposedContent)
  }, [step.output, parsed])

  // Publish the seeded proposal on mount so AgentCard's `editedOutput`
  // mirrors the current buffer even if the user approves without typing.
  // Without this the orchestrator would fall through to `step.output`
  // verbatim — equivalent content, but the "edited" signalling becomes
  // inconsistent across editors.
  const publishRef = useRef(onChange)
  publishRef.current = onChange
  useEffect(() => {
    if (!parsed) return
    publishRef.current({
      ...parsed,
      proposedContent: proposed,
      sizeBytes: proposed.length,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const publish = (next: string) => {
    setProposed(next)
    if (!parsed) {
      onChange({ proposedContent: next, sizeBytes: next.length })
      return
    }
    onChange({
      ...parsed,
      proposedContent: next,
      sizeBytes: next.length,
    })
  }

  if (!parsed) {
    return (
      <div className="tool-approval-editor-empty">
        Waiting for tool output…
      </div>
    )
  }

  const isNewFile = parsed.existingContent === null
  const previousLength = parsed.existingContent?.length ?? 0
  const nextLength = proposed.length
  const delta = nextLength - previousLength
  const deltaLabel = delta === 0 ? '±0' : delta > 0 ? `+${delta}` : `${delta}`

  // Binary / oversized existing content should stay collapsed — showing
  // the full bytes inside a <pre> blows up CLS and, on truly binary
  // files, produces a useless block of U+FFFD replacement glyphs.
  const existingTooLarge =
    parsed.existingContent !== null &&
    parsed.existingContent.length > EXISTING_CONTENT_RENDER_LIMIT
  const existingLooksBinary =
    parsed.existingContent !== null && looksBinary(parsed.existingContent)
  const hideExisting = existingTooLarge || existingLooksBinary

  return (
    <div className="tool-approval-editor tool-approval-editor-workspace-write">
      <div className="tool-approval-editor-meta">
        <FileText size={12} aria-hidden />
        <span
          className="tool-approval-editor-title"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {parsed.relPath}
        </span>
        <span className="tool-approval-editor-meta-spacer" />
        {isNewFile ? (
          <span
            className="tool-approval-editor-meta-stat"
            style={{
              color: 'var(--color-green, #4ade80)',
              fontWeight: 600,
              fontSize: "var(--text-xxs)",
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              border: '1px solid color-mix(in srgb, var(--color-green, #4ade80) 50%, transparent)',
              borderRadius: 3,
              padding: '1px 5px',
            }}
          >
            NEW
          </span>
        ) : null}
        <span className="tool-approval-editor-meta-stat">
          {formatBytes(previousLength)} → {formatBytes(nextLength)}
        </span>
        <span className="tool-approval-editor-meta-stat">{deltaLabel} B</span>
      </div>

      <label
        className="tool-approval-editor-label"
        style={{
          fontSize: 'var(--text-xxs)',
          color: 'var(--color-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          fontWeight: 500,
        }}
      >
        Proposed content (editable)
      </label>
      <textarea
        className="latex-edit-selection-after"
        value={proposed}
        spellCheck={false}
        onChange={(e) => publish(e.target.value)}
        style={{ minHeight: 160, maxHeight: 320 }}
      />

      {isNewFile ? null : hideExisting ? (
        <div
          className="tool-approval-editor-empty"
          style={{ fontStyle: 'italic' }}
        >
          <em>
            Existing content hidden (
            {existingTooLarge
              ? `file is ${formatBytes(previousLength)}, over the ${formatBytes(
                  EXISTING_CONTENT_RENDER_LIMIT,
                )} preview limit`
              : 'looks binary'}
            )
          </em>
        </div>
      ) : (
        <details
          className="tool-approval-editor-details"
          style={{
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-xs, 3px)',
            padding: '4px 6px',
          }}
        >
          <summary
            style={{
              fontSize: 'var(--text-xxs)',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              fontWeight: 500,
            }}
          >
            Existing content ({formatBytes(previousLength)})
          </summary>
          <pre
            className="latex-edit-selection-before"
            style={{
              marginTop: 6,
              maxHeight: 220,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {parsed.existingContent ?? ''}
          </pre>
        </details>
      )}
    </div>
  )
}
