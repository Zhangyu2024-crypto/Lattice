// IconButton — icon-only square button with optional tooltip.
// Used in toolbars, row action cells, and any place a text label would
// crowd the layout. The tooltip label is required — without it, the
// button is inaccessible and the hover target is a guessing game.

import { forwardRef, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { useTooltip } from './Tooltip'

export type IconButtonSize = 'sm' | 'md'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode
  /** Tooltip / aria-label text. Shown on hover after short delay. */
  label: string
  size?: IconButtonSize
}

const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton(
  { icon, label, size = 'sm', className, style, ...rest },
  externalRef,
) {
  const internalRef = useRef<HTMLButtonElement>(null)
  const ref = (externalRef as React.RefObject<HTMLButtonElement>) ?? internalRef
  const tooltip = useTooltip(ref, label)

  const classes = [
    'ui-icon-btn',
    size === 'md' ? 'ui-icon-btn--md' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <>
      <button
        ref={ref}
        className={classes}
        aria-label={label}
        style={style}
        {...tooltip.bind}
        {...rest}
      >
        {icon}
      </button>
      {tooltip.portal}
    </>
  )
})

export default IconButton
