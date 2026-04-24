// Popover picker triggered by typing `@` in the composer. Purely presentational
// plus a thin keyboard state machine — the composer owns open/closed state and
// the query string, so this component stays cheap to mount/unmount.
//
// Layout:
//   - absolutely positioned inside .chat-input-wrapper (caller sets position)
//   - max height ~280px, scrolls internally
//   - rows grouped by `group` when the query is empty; flattened + scored when
//     the user is searching, which matches how developers expect picker-style
//     fuzzy search to behave (a hit buried in "artifacts" should float up next
//     to a hit in "files")

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { File, FileText, Focus, History, Hash } from 'lucide-react'
import type { Mentionable } from '../../types/mention-resolver'
import type { MentionRef } from '../../types/mention'

interface Props {
  open: boolean
  query: string
  recent: MentionRef[]
  mentionables: Mentionable[]
  onSelect: (m: Mentionable) => void
  onClose: () => void
}

// Hard cap: the picker is a drop-down, not a search page. If more than this
// many items qualify we truncate and trust the query box to narrow further.
const MAX_VISIBLE = 50

// Group headers in the order they appear when the query is empty.
//
// Phase δ — artifacts intentionally omitted from the default picker view.
// They are represented inline as chat cards now (see ChatArtifactCard), so
// `@` should surface user-owned context (files + the focused artifact's
// internal elements + recent history), not tool outputs. Artifacts are
// still reachable via fuzzy search on an explicit query — see buildRows.
const GROUP_ORDER: Mentionable['group'][] = [
  'commands',
  'recent',
  'focused',
  'files',
  'workspace',
  'quotes',
]

const GROUP_HEADERS: Record<Mentionable['group'], string> = {
  commands: 'COMMANDS',
  recent: 'RECENT',
  focused: 'FOCUSED',
  files: 'FILES',
  workspace: 'WORKSPACE',
  artifacts: 'ARTIFACTS',
  quotes: 'PDF HIGHLIGHTS',
}

export default function MentionPicker({
  open,
  query,
  recent,
  mentionables,
  onSelect,
  onClose,
}: Props) {
  // `rows` is the final visible sequence interleaving group headers and
  // mentionable rows. We precompute it so keyboard navigation only has to
  // walk a single flat array.
  const rows = useMemo(
    () => buildRows(query, recent, mentionables),
    [query, recent, mentionables],
  )
  const selectable = useMemo(
    () => rows.filter((r): r is MentionableRow => r.kind === 'item'),
    [rows],
  )

  const [activeIndex, setActiveIndex] = useState(0)

  // Reset the cursor to the first selectable row whenever the query or result
  // set changes — otherwise a stale cursor can land outside the filtered list.
  useEffect(() => {
    setActiveIndex(0)
  }, [query, selectable.length])

  // Keyboard handler lives on the document so keys typed inside the textarea
  // (which still has focus while the picker is open) reach us. We mount the
  // listener only when `open` so we don't fight other shortcuts.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((i) => (selectable.length ? (i + 1) % selectable.length : 0))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((i) =>
          selectable.length
            ? (i - 1 + selectable.length) % selectable.length
            : 0,
        )
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        const target = selectable[activeIndex]
        if (target) {
          e.preventDefault()
          onSelect(target.item)
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, selectable, activeIndex, onSelect, onClose])

  // Keep the active row in view when the user navigates with arrow keys.
  const listRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-picker-idx="${activeIndex}"]`,
    )
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex])

  if (!open) return null

  return (
    <div
      ref={listRef}
      className="mention-picker"
      role="listbox"
      aria-label="Mention picker"
    >
      {rows.length === 0 && (
        <div className="mention-picker-empty">No matches</div>
      )}
      {rows.map((row, rowIdx) => {
        if (row.kind === 'header') {
          return (
            <div
              key={`h-${row.group}-${rowIdx}`}
              className="mention-picker-group"
            >
              {GROUP_HEADERS[row.group]}
            </div>
          )
        }
        const isActive = row.selectableIndex === activeIndex
        const m = row.item
        return (
          <div
            key={`i-${rowIdx}`}
            data-picker-idx={row.selectableIndex}
            className={
              'mention-picker-row' + (isActive ? ' active' : '')
            }
            role="option"
            aria-selected={isActive}
            onMouseEnter={() => setActiveIndex(row.selectableIndex)}
            onMouseDown={(e) => {
              // Keep textarea focus; we don't want the click to steal it
              // before our onClick handler runs.
              e.preventDefault()
            }}
            onClick={() => onSelect(m)}
          >
            <span className="mention-picker-icon" aria-hidden>
              {iconForGroup(m.group)}
            </span>
            <span className="mention-picker-label">{m.label}</span>
            {m.sublabel && (
              <span className="mention-picker-sublabel">{m.sublabel}</span>
            )}
            <span className="mention-picker-kind">{m.kindLabel}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Row-building / fuzzy scoring ─────────────────────────────────────────────

type HeaderRow = { kind: 'header'; group: Mentionable['group'] }
type MentionableRow = {
  kind: 'item'
  item: Mentionable
  selectableIndex: number
}
type Row = HeaderRow | MentionableRow

function buildRows(
  query: string,
  recent: MentionRef[],
  mentionables: Mentionable[],
): Row[] {
  const trimmed = query.trim().toLowerCase()

  // When the user is searching, we drop group headers and show a flat
  // relevance-ranked list. A mentionable that appears in `recent` inherits a
  // small score bonus so the user's own history floats up.
  if (trimmed.length > 0) {
    const recentKeys = new Set(recent.map(mentionKey))
    const scored: Array<{ m: Mentionable; score: number }> = []
    for (const m of mentionables) {
      const s = scoreMentionable(m, trimmed, recentKeys)
      if (s > 0) scored.push({ m, score: s })
    }
    scored.sort((a, b) => b.score - a.score)
    const out: Row[] = []
    let idx = 0
    for (const { m } of scored.slice(0, MAX_VISIBLE)) {
      out.push({ kind: 'item', item: m, selectableIndex: idx++ })
    }
    return out
  }

  // Empty query → grouped view. The store does not pre-tag any mentionable
  // as `recent`; we do it here by re-keying the MRU list against the live
  // mentionables so a stale recent ref (whose target was deleted) silently
  // falls out. Any matched item is *moved* to the recent group rather than
  // duplicated, so the user doesn't see the same row twice.
  const recentKeyOrder = recent.map(mentionKey)
  const recentSet = new Set(recentKeyOrder)
  const recentItems: Mentionable[] = []
  const otherItems: Mentionable[] = []
  for (const m of mentionables) {
    if (recentSet.has(mentionKey(m.ref))) recentItems.push(m)
    else otherItems.push(m)
  }
  // Order recentItems to match the MRU sequence (head = most recent).
  recentItems.sort((a, b) => {
    const ai = recentKeyOrder.indexOf(mentionKey(a.ref))
    const bi = recentKeyOrder.indexOf(mentionKey(b.ref))
    return ai - bi
  })

  const byGroup = new Map<Mentionable['group'], Mentionable[]>()
  if (recentItems.length > 0) {
    // Re-tag rather than copy; preserves Mentionable shape (label/sublabel/
    // kindLabel) without forcing the picker to know how to derive them.
    byGroup.set(
      'recent',
      recentItems.map((m) => ({ ...m, group: 'recent' as const })),
    )
  }
  for (const m of otherItems) {
    const arr = byGroup.get(m.group) ?? []
    arr.push(m)
    byGroup.set(m.group, arr)
  }
  const out: Row[] = []
  let visible = 0
  let selectableIndex = 0
  for (const group of GROUP_ORDER) {
    const items = byGroup.get(group) ?? []
    if (items.length === 0) continue
    out.push({ kind: 'header', group })
    for (const m of items) {
      if (visible >= MAX_VISIBLE) break
      out.push({ kind: 'item', item: m, selectableIndex: selectableIndex++ })
      visible++
    }
    if (visible >= MAX_VISIBLE) break
  }
  return out
}

function scoreMentionable(
  m: Mentionable,
  q: string,
  recentKeys: Set<string>,
): number {
  // Case-insensitive substring hits on the three human-readable fields.
  // Earlier matches (position 0) score higher than late matches. Label hits
  // dominate sublabel / kindLabel. A 0 score means "do not show".
  const label = m.label.toLowerCase()
  const sublabel = (m.sublabel ?? '').toLowerCase()
  const kind = m.kindLabel.toLowerCase()

  let score = 0
  const labelIdx = label.indexOf(q)
  if (labelIdx >= 0) score += 100 - Math.min(labelIdx, 40)
  const subIdx = sublabel.indexOf(q)
  if (subIdx >= 0) score += 40 - Math.min(subIdx, 30)
  const kindIdx = kind.indexOf(q)
  if (kindIdx >= 0) score += 20 - Math.min(kindIdx, 15)

  if (score > 0 && recentKeys.has(mentionKey(m.ref))) score += 10
  return score
}

function mentionKey(ref: MentionRef): string {
  switch (ref.type) {
    case 'file':
      return `file:${ref.sessionId}:${ref.relPath}`
    case 'artifact':
      return `artifact:${ref.sessionId}:${ref.artifactId}`
    case 'artifact-element':
      return `element:${ref.sessionId}:${ref.artifactId}:${ref.elementKind}:${ref.elementId}`
    case 'pdf-quote':
      return `pdf-quote:${ref.paperId}:${ref.page}:${ref.quoteHash}`
  }
}

function iconForGroup(group: Mentionable['group']) {
  switch (group) {
    case 'recent':
      return <History size={12} />
    case 'focused':
      return <Focus size={12} />
    case 'files':
      return <FileText size={12} />
    case 'artifacts':
      return <Hash size={12} />
    default:
      return <File size={12} />
  }
}
