// Pure helpers for ChatsDropdown — formatting + search.
//
// These live outside the main component so the dropdown file can stay
// focused on composition / state. No React imports — all functions
// operate on plain values and the Session record. Phase 2 may move
// search over to a worker, in which case this file is the seam.

import type { Session } from '../../../types/session'

/** Radius (in characters) of the snippet we surface when a search hit
 *  lands in message body rather than title. Mirrors quick-switcher
 *  conventions (VS Code's file search is ~40 chars each side). */
export const SNIPPET_RADIUS = 40

/** Human-readable "N ago" string. Falls back to a full date once the
 *  delta exceeds ~4 weeks so the list stays readable for stale chats. */
export function relativeTime(ts: number, now: number): string {
  const delta = now - ts
  if (delta < 60_000) return 'just now'
  const mins = Math.floor(delta / 60_000)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d`
  const weeks = Math.floor(days / 7)
  if (weeks < 4) return `${weeks}w`
  return new Date(ts).toLocaleDateString()
}

/** Strip `@[Name#abcde]` tokens down to `@Name` so the preview text
 *  reads as plain prose instead of leaking the internal ref id. */
export function stripMentionTokens(raw: string): string {
  return raw.replace(/@\[([^\]#]+)#[0-9a-z]{5}\]/g, '@$1')
}

/** First non-empty user message in the session transcript, truncated
 *  to 80 chars. Used as the preview line under the title. */
export function firstUserMessagePreview(ses: Session): string {
  for (const msg of ses.transcript) {
    if (msg.role !== 'user') continue
    const raw = (msg.content ?? '').trim()
    if (raw.length === 0) continue
    const clean = stripMentionTokens(raw)
    return clean.length > 80 ? `${clean.slice(0, 79)}…` : clean
  }
  return ''
}

/**
 * Find the first message body in `ses` whose lowercased content contains
 * `q`, and return a short snippet centered on the match. Skips system
 * rows (artifact cards etc.) and the first user message since that one
 * is already surfaced via {@link firstUserMessagePreview}.
 */
export function contentMatchSnippet(ses: Session, q: string): string | null {
  if (!q) return null
  let skippedFirstUser = false
  for (const msg of ses.transcript) {
    if (msg.role === 'system') continue
    const raw = (msg.content ?? '').trim()
    if (!raw) continue
    if (msg.role === 'user' && !skippedFirstUser) {
      skippedFirstUser = true
      continue
    }
    const clean = stripMentionTokens(raw)
    const lower = clean.toLowerCase()
    const idx = lower.indexOf(q)
    if (idx < 0) continue
    const start = Math.max(0, idx - SNIPPET_RADIUS)
    const end = Math.min(clean.length, idx + q.length + SNIPPET_RADIUS)
    const prefix = start > 0 ? '…' : ''
    const suffix = end < clean.length ? '…' : ''
    const slice = clean
      .slice(start, end)
      .replace(/\s+/g, ' ')
      .trim()
    const roleTag = msg.role === 'user' ? 'you' : 'ai'
    return `${roleTag}: ${prefix}${slice}${suffix}`
  }
  return null
}

/** Broad match used by the list filter: title, first-user-message, or
 *  any non-system body. `q` must already be lowercased + trimmed. */
export function sessionMatchesQuery(ses: Session, q: string): boolean {
  if (!q) return true
  const title = ses.title.toLowerCase()
  if (title.includes(q)) return true
  const firstUser = firstUserMessagePreview(ses).toLowerCase()
  if (firstUser.includes(q)) return true
  for (const msg of ses.transcript) {
    if (msg.role === 'system') continue
    const raw = (msg.content ?? '').toLowerCase()
    if (raw.includes(q)) return true
  }
  return false
}
