// Mention protocol for the AI composer.
//
// A MentionRef is a structured pointer to something in the current session
// (a file, an artifact, or a structured element inside an artifact's payload)
// that the user has explicitly attached to an LLM turn. The composer keeps
// mentions alongside the plain-text message; the model-facing layer resolves
// each ref into a prompt context block so the LLM never has to guess what
// "the third peak" means.
//
// See docs/CHAT_PANEL_REDESIGN.md §4 for the full protocol. Two deliberately
// deferred types (`selection`, `session`) are intentionally not modelled here
// and will be reintroduced in MP-5.

/**
 * A 5-character base36 token that uniquely identifies a mention **within a
 * single transcript message**. Anchors are not globally unique — a follow-up
 * assistant reply that references the same underlying ref will be assigned a
 * fresh anchor for that reply's own mentions array.
 *
 * Rendered in message bodies as `@[label#anchor](mention://…)`.
 */
export type MentionAnchor = string

export type MentionElementKind =
  | 'peak'
  | 'peak-group'
  | 'residual'
  | 'phase'
  | 'rietveld-param'
  | 'xps-fit'
  | 'xps-component'
  | 'xps-quant-row'
  | 'raman-match'
  | 'graph-node'
  | 'graph-edge'
  | 'paper-section'
  | 'latex-section'

export type MentionRef =
  | { type: 'file'; sessionId: string; relPath: string }
  | { type: 'artifact'; sessionId: string; artifactId: string }
  | {
      type: 'artifact-element'
      sessionId: string
      artifactId: string
      elementKind: MentionElementKind
      elementId: string
      /** Optional cold-render label so chips stay legible even if the target
       *  artifact is temporarily unreachable (e.g. during rehydrate). */
      label?: string
    }
  /** A quoted passage pulled out of a library PDF via the selection
   *  toolbar's "Ask AI" action. Distinct from `artifact` because the
   *  source is a library row (not a session-local artifact) and the chip
   *  has to carry enough state to scroll the PDF viewer back to the
   *  quote on click. `quoteHash` = sha-ish hash of `paperId:page:text`
   *  so mentions de-dupe when the user asks twice about the same span. */
  | {
      type: 'pdf-quote'
      paperId: number | string
      page: number
      quoteHash: string
      /** Truncated (≤200 char) plain-text excerpt — cheap to keep, lets
       *  the chip render a useful tooltip without re-fetching the PDF. */
      excerpt: string
    }

const ANCHOR_LENGTH = 5
const ANCHOR_ALPHABET_SIZE = 36 ** ANCHOR_LENGTH // ~60M combinations
// In practice the random-pick path returns on the first attempt; the cap
// exists to rule out pathological inputs (a Set that happens to contain
// most of the 60M-entry space). If we exhaust the random budget we fall
// through to a deterministic linear scan that is guaranteed to find a free
// slot or surface the real problem (the caller's Set is over-filled).
const MAX_RANDOM_ATTEMPTS = 64

const toAnchor = (n: number): MentionAnchor =>
  (n % ANCHOR_ALPHABET_SIZE).toString(36).padStart(ANCHOR_LENGTH, '0')

/**
 * Produce a fresh anchor that does not collide with any of the anchors
 * already used in the same transcript message. The returned anchor is
 * guaranteed unique with respect to `existing` — the function never returns
 * a colliding value. If the space is effectively full (`existing.size` close
 * to 36^5) it throws rather than lying about uniqueness.
 *
 * Collisions are vanishingly rare in practice (< 10⁻⁵ at 20 mentions per
 * message — see docs/CHAT_PANEL_REDESIGN.md R9).
 */
export const generateMentionAnchor = (existing: Set<string>): MentionAnchor => {
  if (existing.size >= ANCHOR_ALPHABET_SIZE) {
    throw new Error(
      'generateMentionAnchor: anchor space exhausted (existing.size >= 36^5)',
    )
  }
  for (let attempt = 0; attempt < MAX_RANDOM_ATTEMPTS; attempt++) {
    const candidate = toAnchor(Math.floor(Math.random() * ANCHOR_ALPHABET_SIZE))
    if (!existing.has(candidate)) return candidate
  }
  // Deterministic fallback: walk the space starting from a time-seeded
  // offset. The size check at the top guarantees we find a free slot.
  const start = Date.now() % ANCHOR_ALPHABET_SIZE
  for (let offset = 0; offset < ANCHOR_ALPHABET_SIZE; offset++) {
    const candidate = toAnchor(start + offset)
    if (!existing.has(candidate)) return candidate
  }
  // Unreachable given the size check, but TS needs a terminal return.
  throw new Error('generateMentionAnchor: unreachable')
}
