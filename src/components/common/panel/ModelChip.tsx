import { ChevronDown } from 'lucide-react'

interface Props {
  /** Label shown inside the chip, e.g. `'Claude Sonnet · 12k'`. */
  label: string
  /** Visual tone — `accent` when the subject is "live" (backend up, model
   *  resolved); `muted` when it's a neutral/offline context. */
  tone?: 'accent' | 'muted'
  /** Rendered as a button when provided; as a span otherwise. */
  onClick?: () => void
  title?: string
  /** Omit the leading status dot (e.g. composer already shows connection elsewhere). */
  hideDot?: boolean
  /** Trailing chevron (e.g. Cursor-style model dropdown in the input capsule). */
  showChevron?: boolean
}

/**
 * Shared status chip for "active model / provider" pills used in the
 * composer capsule footer and panel chrome. Keeps a single visual source
 * of truth for the small pill that users will see dozens of times per
 * session.
 */
export default function ModelChip({
  label,
  tone = 'accent',
  onClick,
  title,
  hideDot = false,
  showChevron = false,
}: Props) {
  const classes = [
    'panel-chip',
    tone === 'muted' ? 'muted' : '',
    onClick ? 'clickable' : '',
    showChevron ? 'panel-chip--with-chevron' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const content = (
    <>
      {!hideDot ? <span className="panel-chip-dot" aria-hidden /> : null}
      <span className="panel-chip-label">{label}</span>
      {showChevron ? (
        <ChevronDown
          size={12}
          strokeWidth={2.25}
          className="panel-chip-chevron"
          aria-hidden
        />
      ) : null}
    </>
  )

  if (onClick) {
    return (
      <button type="button" className={classes} onClick={onClick} title={title}>
        {content}
      </button>
    )
  }
  return (
    <span className={classes} title={title}>
      {content}
    </span>
  )
}
