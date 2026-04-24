// Tiny pub-sub for "user wants the composer to react to an external signal".
//
// Used by:
//   - canvas artifact tables (right-click → "Mention in chat") — mention-add
//   - InspectorRail (header action button) — mention-add
//   - ArtifactCanvas empty-state entry cards — prefill
//   - CommandPalette "Start Research Brief / Literature Survey" — prefill
//
// We keep the surface deliberately narrow — a small set of named events,
// each with a single payload shape, no general-purpose UI bus. The composer
// is the sole subscriber today; if a second consumer ever appears we can
// promote this to a real pub-sub. Until then, CustomEvent on `window` keeps
// the implementation visible and avoids module-coupling between the composer
// and every place that wants to nudge its state.

import { useEffect } from 'react'
import type { ComposerMode } from '../types/llm'
import type { MentionRef } from '../types/mention'

export interface MentionAddRequest {
  ref: MentionRef
  /** Pre-resolved display label. Provided by the dispatcher so the composer
   *  doesn't have to call back into the store at dispatch time. */
  label: string
}

const MENTION_EVENT = 'lattice:composer-mention-add'

/**
 * Fire-and-forget request to the composer to insert a mention chip + token.
 * No-op outside a browser environment so module imports stay safe under
 * SSR / unit-test contexts.
 */
export function dispatchMentionAdd(req: MentionAddRequest): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<MentionAddRequest>(MENTION_EVENT, { detail: req }),
  )
}

/**
 * Subscribe to mention-add requests. Wraps the listener in a `useEffect` so
 * components remount cleanly. The handler must be stable across renders
 * (use `useCallback`) — otherwise we'd add and remove the listener every
 * render.
 */
export function useComposerMentionListener(
  handler: (req: MentionAddRequest) => void,
): void {
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<MentionAddRequest>).detail
      if (detail) handler(detail)
    }
    window.addEventListener(MENTION_EVENT, listener)
    return () => window.removeEventListener(MENTION_EVENT, listener)
  }, [handler])
}

// ── Prefill ────────────────────────────────────────────────────────────────
//
// Used by the EmptyState entry cards and CommandPalette "Start …" commands
// to ask the composer to prepopulate its textarea and switch to a specific
// mode. The composer listener focuses the caret at the end after commit.

export interface ComposerPrefillRequest {
  /** Text to insert into the composer textarea. */
  text: string
  /** Target composer mode. Typically 'agent' for research/survey flows. */
  mode: ComposerMode
  /** When true (default), the text is appended (separated by a blank line)
   *  if the textarea is non-empty; the caller can set false to replace
   *  whatever is there. We never truncate silently when appending. */
  append?: boolean
  /** Override the agent loop's iteration ceiling for the NEXT single send
   *  triggered from this prefill. Cleared after use. Required by research
   *  flows that chain plan → per-section drafts → finalize (~12 tool
   *  calls). Omit for ordinary prefills. */
  maxIterations?: number
}

const PREFILL_EVENT = 'lattice:composer-prefill'

export function dispatchComposerPrefill(req: ComposerPrefillRequest): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<ComposerPrefillRequest>(PREFILL_EVENT, { detail: req }),
  )
}

export function useComposerPrefillListener(
  handler: (req: ComposerPrefillRequest) => void,
): void {
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<ComposerPrefillRequest>).detail
      if (detail) handler(detail)
    }
    window.addEventListener(PREFILL_EVENT, listener)
    return () => window.removeEventListener(PREFILL_EVENT, listener)
  }, [handler])
}

// ── Focus ──────────────────────────────────────────────────────────────────
//
// Payload-free nudge asking the composer to take focus. Used by the Explorer's
// hover "@" action: after we dispatch a mention-add the user's attention is
// still in the file tree, so we pull focus into the textarea so their next
// keystroke lands in the chat draft. Kept as a distinct event rather than
// folded into `MentionAddRequest` so non-mention callers (e.g. a future
// "Focus chat" keybinding) can re-use it without synthesizing a fake ref.

const FOCUS_EVENT = 'lattice:composer-focus'

export function dispatchComposerFocus(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(FOCUS_EVENT))
}

export function useComposerFocusListener(handler: () => void): void {
  useEffect(() => {
    const listener = () => handler()
    window.addEventListener(FOCUS_EVENT, listener)
    return () => window.removeEventListener(FOCUS_EVENT, listener)
  }, [handler])
}
