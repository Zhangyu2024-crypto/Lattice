import type { LatexDocumentPayload } from '../../../../../types/latex'
import { toast } from '../../../../../stores/toast-store'
import { runSelectionAction } from '../../../../../lib/latex/ai-actions'
import type { SelectionMenuCommandCtx } from '../LatexSelectionMenu'

/**
 * Execute an AI selection command from the CodeMirror selection menu.
 * Extracted from LatexDocumentCard to keep the component focused on
 * wiring. The caller is responsible for holding the `aiInFlightRef`
 * mutex and flipping `setAiBusy` — this helper only does the RPC,
 * doc-identity check, and splice. The parent gates entry so a second
 * concurrent call is already handled outside.
 */
export async function runSelectionCommand({
  ctx,
  payload,
  sessionId,
}: {
  ctx: SelectionMenuCommandCtx
  payload: LatexDocumentPayload
  sessionId: string
}): Promise<void> {
  const { verb, selection, from, to, view } = ctx
  // Snapshot doc identity so we can reject the splice if the user has
  // kept typing while the LLM call was in flight.
  const docAtStart = view.state.doc
  // Cheap context windows. 600/400 chars before/after the selection is
  // enough for the LLM to stay in-register without blowing the prompt.
  const contextBefore = view.state.sliceDoc(Math.max(0, from - 600), from)
  const contextAfter = view.state.sliceDoc(
    to,
    Math.min(view.state.doc.length, to + 400),
  )
  const outline = payload.outline
    .map((o) => `${'#'.repeat(o.level)} ${o.title}  (${o.file})`)
    .join('\n')
  const result = await runSelectionAction({
    verb,
    selection,
    contextBefore,
    contextAfter,
    outline,
    sessionId,
  })
  if (!result.ok) {
    toast.error(`AI ${verb} failed: ${result.error ?? 'unknown'}`)
    return
  }
  if (view.state.doc !== docAtStart) {
    toast.warn('Document changed during AI call — discarded the replacement')
    return
  }
  view.dispatch({
    changes: { from, to, insert: result.content },
    selection: { anchor: from, head: from + result.content.length },
    scrollIntoView: true,
  })
}
