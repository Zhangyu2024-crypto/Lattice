// Phase 5 — inline approval editor for the `workspace_edit_file` tool.
//
// The LLM proposes N find/replace patches against an existing workspace
// file. This editor shows each patch as a red/green diff pair, lets the
// user reject any subset, and recomputes the final preview on the fly
// so Approve ships exactly what the user sees in the "Final preview"
// block.
//
// Contract (pinned by the Phase 4 / Phase 5 split):
//
//   type WorkspaceEditFileProposal = {
//     relPath: string
//     existingContent: string
//     patches: Array<{ oldString: string; newString: string }>
//     preview: string                                     // after all patches
//     errors?: Array<{ index: number; reason: string }>   // per-patch warnings
//   }
//
// Rejection flow:
//   - Remove the patch from the local `patches` array.
//   - Re-apply the remaining patches against `existingContent` from
//     scratch (each patch replaces the first occurrence of oldString,
//     matching the simplest plausible backend semantics).
//   - If any patch fails (oldString absent or duplicated), record an
//     entry in `errors` with a human-readable reason; the UI flags the
//     offending patch in red.
//
// The emitted `onChange({...proposal, patches, preview, errors})` is
// what the orchestrator / applier sees on Approve.

import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText } from 'lucide-react'
import type { TaskStep } from '../../../../types/session'

interface WorkspacePatch {
  oldString: string
  newString: string
}

interface WorkspacePatchError {
  index: number
  reason: string
}

interface WorkspaceEditFileProposal {
  relPath: string
  existingContent: string
  patches: WorkspacePatch[]
  preview: string
  errors?: WorkspacePatchError[]
}

function parseOutput(output: unknown): WorkspaceEditFileProposal | null {
  if (!output || typeof output !== 'object') return null
  const c = output as Partial<WorkspaceEditFileProposal>
  if (typeof c.relPath !== 'string') return null
  if (typeof c.existingContent !== 'string') return null
  if (!Array.isArray(c.patches)) return null
  const patches: WorkspacePatch[] = []
  for (const p of c.patches) {
    if (!p || typeof p !== 'object') continue
    const entry = p as Partial<WorkspacePatch>
    if (typeof entry.oldString !== 'string') continue
    if (typeof entry.newString !== 'string') continue
    patches.push({ oldString: entry.oldString, newString: entry.newString })
  }
  const preview = typeof c.preview === 'string' ? c.preview : c.existingContent
  const errors: WorkspacePatchError[] = Array.isArray(c.errors)
    ? c.errors
        .filter(
          (e): e is WorkspacePatchError =>
            !!e &&
            typeof e === 'object' &&
            typeof (e as WorkspacePatchError).index === 'number' &&
            typeof (e as WorkspacePatchError).reason === 'string',
        )
        .map((e) => ({ index: e.index, reason: e.reason }))
    : []
  return {
    relPath: c.relPath,
    existingContent: c.existingContent,
    patches,
    preview,
    errors,
  }
}

/** Clip long strings for inline preview. We keep the head and tail so
 *  the user can still orient themselves when a patch spans a whole
 *  paragraph. */
function truncateForDisplay(value: string, limit = 300): string {
  if (value.length <= limit) return value
  const head = Math.floor(limit * 0.7)
  const tail = limit - head - 1
  return `${value.slice(0, head)} … ${value.slice(-tail)}`
}

/** Re-run all patches over `base` and collect per-patch failures. We
 *  intentionally keep the semantics simple (replace-first-occurrence)
 *  and surface any ambiguity as an error rather than silently picking a
 *  match — the goal is to give the user honest feedback about which
 *  patches the backend will actually be able to apply. */
function applyPatches(
  base: string,
  patches: WorkspacePatch[],
): { preview: string; errors: WorkspacePatchError[] } {
  let current = base
  const errors: WorkspacePatchError[] = []
  patches.forEach((patch, index) => {
    if (patch.oldString === patch.newString) {
      // Degenerate but valid — no-op patches apply cleanly.
      return
    }
    if (patch.oldString === '') {
      errors.push({
        index,
        reason: 'oldString is empty — patch cannot be anchored',
      })
      return
    }
    const first = current.indexOf(patch.oldString)
    if (first === -1) {
      errors.push({
        index,
        reason: 'oldString not found in file (may have been consumed by a prior patch)',
      })
      return
    }
    const second = current.indexOf(patch.oldString, first + 1)
    if (second !== -1) {
      const occurrences = current.split(patch.oldString).length - 1
      errors.push({
        index,
        reason: `oldString appears ${occurrences} times — edit this patch or reject`,
      })
      return
    }
    current =
      current.slice(0, first) +
      patch.newString +
      current.slice(first + patch.oldString.length)
  })
  return { preview: current, errors }
}

interface Props {
  step: TaskStep
  onChange: (edited: unknown) => void
}

export default function WorkspaceEditFileEditor({ step, onChange }: Props) {
  const parsed = useMemo(() => parseOutput(step.output), [step.output])

  // The editor's live state is the working patches list. Everything
  // else (preview, errors) is derived from it. We keep rejected indices
  // separately so the UI can show "0 of N" counts if we ever want; but
  // the emitted payload only contains the surviving patches, matching
  // the backend's applier contract.
  const [patches, setPatches] = useState<WorkspacePatch[]>(
    () => parsed?.patches ?? [],
  )
  const seededRef = useRef<unknown>(null)
  useEffect(() => {
    if (!parsed) return
    if (seededRef.current === step.output) return
    seededRef.current = step.output
    setPatches(parsed.patches)
  }, [step.output, parsed])

  // Recompute preview + errors whenever the working patch list changes.
  // We always rebuild from `existingContent`, never from the upstream
  // `preview` string, so the numbers stay trustworthy regardless of
  // what the backend shipped.
  const { preview, errors } = useMemo(() => {
    if (!parsed) return { preview: '', errors: [] as WorkspacePatchError[] }
    return applyPatches(parsed.existingContent, patches)
  }, [parsed, patches])

  // Merge backend-reported errors with recompute errors — the backend
  // might know something we don't (e.g. encoding hiccups), so we keep
  // both but de-dupe by index + reason.
  const mergedErrors = useMemo(() => {
    const out: WorkspacePatchError[] = []
    const seen = new Set<string>()
    const push = (e: WorkspacePatchError) => {
      // Only carry backend errors for patches that still exist after
      // rejections. Indices are re-numbered by our local patches array,
      // so we clamp anything out of range.
      if (e.index < 0 || e.index >= patches.length) return
      const key = `${e.index}::${e.reason}`
      if (seen.has(key)) return
      seen.add(key)
      out.push(e)
    }
    for (const e of errors) push(e)
    for (const e of parsed?.errors ?? []) push(e)
    return out
  }, [errors, parsed, patches.length])

  const errorsByIndex = useMemo(() => {
    const map = new Map<number, WorkspacePatchError[]>()
    for (const e of mergedErrors) {
      const list = map.get(e.index) ?? []
      list.push(e)
      map.set(e.index, list)
    }
    return map
  }, [mergedErrors])

  // Publish the current snapshot on every change. The orchestrator uses
  // `editedOutput` on Approve — without this mount-time publish the
  // approve path would replay the raw backend output and lose any
  // rejections the user made before their first interaction.
  const publishRef = useRef(onChange)
  publishRef.current = onChange
  useEffect(() => {
    if (!parsed) return
    publishRef.current({
      ...parsed,
      patches,
      preview,
      errors: mergedErrors,
    })
  }, [parsed, patches, preview, mergedErrors])

  const rejectPatch = (index: number) => {
    setPatches((prev) => prev.filter((_, i) => i !== index))
  }

  if (!parsed) {
    return (
      <div className="tool-approval-editor-empty">
        Waiting for tool output…
      </div>
    )
  }

  const allRejected = parsed.patches.length > 0 && patches.length === 0
  const errorCount = mergedErrors.length

  return (
    <div className="tool-approval-editor tool-approval-editor-workspace-edit">
      <div className="tool-approval-editor-meta">
        <FileText size={12} aria-hidden />
        <span
          className="tool-approval-editor-title"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {parsed.relPath}
        </span>
        <span className="tool-approval-editor-meta-spacer" />
        <span className="tool-approval-editor-meta-stat">
          {patches.length} patch{patches.length === 1 ? '' : 'es'},{' '}
          {errorCount} error{errorCount === 1 ? '' : 's'}
        </span>
      </div>

      {allRejected ? (
        <div
          className="tool-approval-editor-empty"
          style={{ fontStyle: 'italic' }}
        >
          All patches rejected — nothing will be written.
        </div>
      ) : patches.length === 0 ? (
        <div className="tool-approval-editor-empty">
          Tool proposed no patches.
        </div>
      ) : (
        <div
          className="workspace-edit-patch-list"
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          {patches.map((patch, index) => {
            const errs = errorsByIndex.get(index) ?? []
            const hasError = errs.length > 0
            return (
              <div
                key={index}
                className="workspace-edit-patch"
                style={{
                  border: hasError
                    ? '1px solid color-mix(in srgb, var(--color-red, #ef4444) 55%, transparent)'
                    : '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-xs, 3px)',
                  padding: '6px 8px',
                  background: 'rgba(0, 0, 0, 0.18)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 'var(--text-xxs)',
                    color: 'var(--color-text-muted)',
                  }}
                >
                  <span style={{ fontWeight: 600 }}>Patch #{index + 1}</span>
                  <span style={{ flex: 1 }} />
                  <button
                    type="button"
                    className="tool-approval-editor-delete"
                    onClick={() => rejectPatch(index)}
                    title="Reject this patch"
                    style={{
                      border: '1px solid var(--color-border)',
                      padding: '2px 8px',
                      fontSize: 'var(--text-xxs)',
                      cursor: 'pointer',
                      color: 'var(--color-text-muted)',
                      background: 'transparent',
                      borderRadius: 'var(--radius-xs, 3px)',
                    }}
                  >
                    [reject]
                  </button>
                </div>
                <PatchLine kind="remove" text={truncateForDisplay(patch.oldString)} />
                <PatchLine kind="add" text={truncateForDisplay(patch.newString)} />
                {hasError
                  ? errs.map((e, ei) => (
                      <div
                        key={ei}
                        style={{
                          fontSize: 'var(--text-xxs)',
                          color: 'var(--color-red, #ef4444)',
                          padding: '2px 4px',
                          border:
                            '1px solid color-mix(in srgb, var(--color-red, #ef4444) 40%, transparent)',
                          borderRadius: 'var(--radius-xs, 3px)',
                          background:
                            'color-mix(in srgb, var(--color-red, #ef4444) 10%, transparent)',
                        }}
                      >
                        ⚠ {e.reason}
                      </div>
                    ))
                  : null}
              </div>
            )
          })}
        </div>
      )}

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
          Final preview
        </summary>
        <pre
          className="latex-edit-selection-before"
          style={{
            marginTop: 6,
            maxHeight: 200,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {preview}
        </pre>
      </details>
    </div>
  )
}

/** Single red- or green-prefixed row inside a patch card. Kept as a
 *  small subcomponent so the map in the parent doesn't drown in inline
 *  style prop noise. */
function PatchLine({
  kind,
  text,
}: {
  kind: 'remove' | 'add'
  text: string
}) {
  const isAdd = kind === 'add'
  const prefix = isAdd ? '+' : '−'
  const color = isAdd
    ? 'var(--color-green, #4ade80)'
    : 'var(--color-red, #ef4444)'
  const bg = isAdd
    ? 'color-mix(in srgb, var(--color-green, #4ade80) 10%, transparent)'
    : 'color-mix(in srgb, var(--color-red, #ef4444) 10%, transparent)'
  return (
    <div
      style={{
        display: 'flex',
        gap: 6,
        alignItems: 'flex-start',
        fontFamily: 'var(--font-mono)',
        fontSize: "var(--text-xs)",
        lineHeight: 1.45,
        color: 'var(--color-text-primary)',
        background: bg,
        padding: '3px 6px',
        borderRadius: 'var(--radius-xs, 3px)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      <span
        style={{
          color,
          fontWeight: 600,
          flexShrink: 0,
          width: '1ch',
        }}
        aria-hidden
      >
        {prefix}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>{text || <em>(empty)</em>}</span>
    </div>
  )
}
