import { useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

// Collapsible section matching pro.html `.section-collapse` — a bold header
// with a disclosure chevron, and a padded body underneath.

interface Props {
  title: string
  children: ReactNode
  defaultOpen?: boolean
  right?: ReactNode
}

export default function ProSection({
  title,
  children,
  defaultOpen = true,
  right,
}: Props) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="pro-section-root">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="pro-section-header"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="pro-section-title">{title}</span>
        <span className="pro-section-spacer" />
        {right}
      </button>
      {open && <div className="pro-section-body">{children}</div>}
    </div>
  )
}
