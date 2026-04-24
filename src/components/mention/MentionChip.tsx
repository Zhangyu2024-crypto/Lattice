// Read-only / removable pill that stands in for a MentionRef anywhere chip
// chrome makes sense (composer chips bar, rendered inside message bubbles,
// preview popovers). The chip is deliberately dumb: it does not resolve the
// ref, does not subscribe to any store — all labels / state are pushed in.
//
// Two tones:
//   - 'normal'   accent-coloured pill (default)
//   - 'redacted' muted with a red dot, for mentions that were stripped from
//                an outbound payload because they exceeded the budget cap.
//
// `missing=true` greys the chip out + tooltip; used when a chip is rendered
// inside a historical message but the underlying artifact/file no longer
// exists in the session.

import { X } from 'lucide-react'
import type { MentionRef } from '../../types/mention'

export type MentionChipTone = 'normal' | 'redacted'

interface Props {
  label: string
  anchor?: string
  ref?: MentionRef
  missing?: boolean
  tone?: MentionChipTone
  onRemove?: () => void
  /** Optional click handler — consumer decides what "focus" means. The chip
   *  does not navigate on its own. */
  onClick?: () => void
  /** Test id hook — helps downstream selection without coupling to text. */
  testId?: string
}

export default function MentionChip({
  label,
  anchor,
  ref,
  missing,
  tone = 'normal',
  onRemove,
  onClick,
  testId,
}: Props) {
  const classes = ['mention-chip']
  if (onRemove) classes.push('removable')
  if (missing) classes.push('missing')
  if (tone === 'redacted') classes.push('redacted')
  if (onClick) classes.push('clickable')

  const title = buildTitle({ label, anchor, ref, missing, tone })

  // Use a <span> (not <button>) for the chip itself so it nests happily inside
  // markdown-rendered paragraphs; the remove affordance is its own button to
  // keep keyboard semantics honest.
  return (
    <span
      className={classes.join(' ')}
      title={title}
      data-testid={testId}
      data-anchor={anchor}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (!onClick) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      {tone === 'redacted' && <span className="mention-chip-dot" aria-hidden />}
      <span className="mention-chip-at" aria-hidden>
        @
      </span>
      <span className="mention-chip-label">{label}</span>
      {onRemove && (
        <button
          type="button"
          className="mention-chip-remove"
          aria-label={`Remove mention ${label}`}
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
        >
          <X size={10} strokeWidth={2.5} />
        </button>
      )}
    </span>
  )
}

function buildTitle({
  label,
  anchor,
  ref,
  missing,
  tone,
}: {
  label: string
  anchor?: string
  ref?: MentionRef
  missing?: boolean
  tone: MentionChipTone
}): string {
  if (missing) return `${label} — no longer available`
  if (tone === 'redacted')
    return `${label} — dropped from prompt (budget)`
  const parts: string[] = [label]
  if (anchor) parts.push(`#${anchor}`)
  if (ref) parts.push(`(${describeRef(ref)})`)
  return parts.join(' ')
}

function describeRef(ref: MentionRef): string {
  switch (ref.type) {
    case 'file':
      return `file: ${ref.relPath}`
    case 'artifact':
      return `artifact: ${ref.artifactId}`
    case 'artifact-element':
      return `${ref.elementKind}: ${ref.elementId}`
    case 'pdf-quote': {
      const src = typeof ref.paperId === 'string' ? ref.paperId : `#${ref.paperId}`
      const excerpt = ref.excerpt
        ? ref.excerpt.length > 80
          ? `"${ref.excerpt.slice(0, 77)}…"`
          : `"${ref.excerpt}"`
        : ''
      return `${src} · p.${ref.page}${excerpt ? '\n' + excerpt : ''}`
    }
  }
}
