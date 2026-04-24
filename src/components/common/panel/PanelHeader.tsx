import type { ReactNode } from 'react'

interface Props {
  /** Uppercase, tracked title shown on the left. Optional — callers that
   *  render their own interactive title (e.g. a segmented control) can omit
   *  it and place the primary content via `children`. */
  label?: string
  /** Additional content on the left, after the optional label. */
  children?: ReactNode
  /** Right-aligned content (chips, icon buttons, menus). */
  actions?: ReactNode
  /** Slightly shorter header used inside dense panels (composer, inspector). */
  dense?: boolean
  /** Escape hatch for rare per-instance tweaks. */
  className?: string
}

/**
 * Shared `[ left | spacer | right ]` panel header used by the composer, the
 * task timeline and future inspector/provenance panels. Keeps vertical
 * rhythm, typography and border treatment consistent without each caller
 * re-declaring the same inline style block.
 */
export default function PanelHeader({
  label,
  children,
  actions,
  dense = false,
  className = '',
}: Props) {
  const classes = ['panel-header', dense ? 'dense' : '', className]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes}>
      <div className="panel-header-left">
        {label ? <span className="panel-header-title">{label}</span> : null}
        {children}
      </div>
      <div className="panel-header-spacer" aria-hidden />
      {actions ? <div className="panel-header-right">{actions}</div> : null}
    </div>
  )
}
