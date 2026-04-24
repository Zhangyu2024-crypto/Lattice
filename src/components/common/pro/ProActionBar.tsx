import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
  right?: ReactNode
}

export default function ProActionBar({ children, right }: Props) {
  return (
    <div className="pro-action-bar">
      <div className="pro-action-bar-group">{children}</div>
      {right && (
        <>
          <span className="pro-action-bar-spacer" />
          <div className="pro-action-bar-group">{right}</div>
        </>
      )}
    </div>
  )
}
