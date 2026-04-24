// Separator — semantic `role="separator"` divider. Replaces the
// ad-hoc `<div style={{ borderLeft: '1px solid var(--color-border)' }} />`
// patterns scattered across toolbars and headers.

import type { HTMLAttributes } from 'react'

interface Props extends HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical'
}

export default function Separator({
  orientation = 'horizontal',
  className,
  style,
  ...rest
}: Props) {
  const classes = [
    'ui-separator',
    orientation === 'vertical'
      ? 'ui-separator--vertical'
      : 'ui-separator--horizontal',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')
  return <div role="separator" className={classes} style={style} {...rest} />
}
