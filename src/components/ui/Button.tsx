// Button — unified primary / secondary / ghost / danger button across
// the app. Replaces the `primaryBtn` / `secondaryBtn` / `ghostBtn` local
// const blocks that every artifact card was redefining in inline style.
//
// Design rules (Linear-inspired):
//   - Sizes: `sm` (compact toolbar) and `md` (dialog / empty state CTA).
//     No `xs` — sub-24px buttons read as chips, not actions; use <Badge>
//     or <IconButton> if that's what you need.
//   - Variants: `primary` (graphite fill), `secondary` (bordered surface),
//     `ghost` (no chrome, content-aware hover), `danger` (destructive).
//   - No hover `transform: translateY`. Buttons that jump on hover
//     trigger layout jitter in dense UI.
//   - Hover / disabled / focus states come from the CSS rules registered
//     for `.ui-btn` in `styles/primitives.css`; React stays render-cheap.

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Optional leading icon. Auto-aligned with `display:inline-flex`. */
  leading?: ReactNode
  /** Optional trailing icon (e.g., caret for split buttons). */
  trailing?: ReactNode
  /** Full-width inside flex parent. */
  block?: boolean
}

const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  {
    variant = 'secondary',
    size = 'sm',
    leading,
    trailing,
    block = false,
    className,
    style,
    ...rest
  },
  ref,
) {
  const classes = [
    'ui-btn',
    `ui-btn--${variant}`,
    `ui-btn--${size}`,
    block ? 'ui-btn--block' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button ref={ref} className={classes} style={style} {...rest}>
      {leading}
      {rest.children}
      {trailing}
    </button>
  )
})

export default Button
