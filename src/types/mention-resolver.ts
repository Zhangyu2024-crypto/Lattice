// Shared types for the mention picker and mention-preview paths.
//
// Kept separate from `src/types/mention.ts` (which defines the wire-level
// `MentionRef` union and anchor format) because these types are UI-facing:
// the picker renders `Mentionable` rows, and `resolveMentionPreview` returns
// `MentionPreview` snapshots used by chips, toasts, and outgoing LLM prompt
// context blocks. See docs/CHAT_PANEL_REDESIGN.md §5.2 / §6.4.

import type { MentionRef } from './mention'

/**
 * A single row in the mention picker — a materialized candidate the user can
 * insert into the composer. Rows are grouped (`group`) and surfaced in the
 * order the picker prefers to display them; the picker itself is responsible
 * for search/filter/keyboard behaviour.
 */
export interface Mentionable {
  /** The structured reference the composer will attach if this row is picked. */
  ref: MentionRef
  /** Short, bold-line label (e.g. peak label, artifact title, file name). */
  label: string
  /** Optional secondary text (e.g. "position 31.72", "xrd-analysis"). */
  sublabel?: string
  /** Display-ready kind tag for the row badge (e.g. "peak", "file", "xrd"). */
  kindLabel: string
  /** Which picker section this row belongs to. */
  group:
    | 'recent'
    | 'focused'
    | 'files'
    | 'workspace'
    | 'artifacts'
    | 'quotes'
    | 'commands'
  /**
   * When set, selecting this row inserts the literal text verbatim
   * (replacing the `@…` trigger) instead of creating a @-mention chip.
   * Reserved for literal command shortcuts; these rows are not anchored
   * MentionRefs and `ref` is ignored when this field is present.
   */
  commandInsert?: string
}

/**
 * A lightweight, synchronous resolution of a `MentionRef` into the minimum
 * fields the UI (chips, toasts) or the LLM prompt assembler needs.
 *
 * `missing: true` signals that the target no longer exists in the current
 * session (e.g. an artifact was deleted after the message was sent); the
 * caller is expected to render a dimmed/"redacted" chip and, on the LLM
 * side, inform the model the reference is no longer resolvable.
 */
export interface MentionPreview {
  label: string
  previewText?: string
  missing?: boolean
}
