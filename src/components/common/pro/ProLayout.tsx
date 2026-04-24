import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

// Split layout used by every Pro workbench: main content (chart / editor) on
// the left, collapsible parameter panel on the right, and an optional bottom
// action bar spanning the full width. A draggable divider between the two
// panes mirrors pro.html's `panel-resize-handle`.

interface Props {
  left: ReactNode
  right: ReactNode
  footer?: ReactNode
  // Initial right-panel width in pixels. Defaults to 380 (pro.html default).
  initialRightWidth?: number
  minRightWidth?: number
  maxRightWidth?: number
}

export default function ProLayout({
  left,
  right,
  footer,
  initialRightWidth = 380,
  minRightWidth = 280,
  maxRightWidth = 560,
}: Props) {
  const [rightWidth, setRightWidth] = useState(initialRightWidth)
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null)

  const onHandleDown = useCallback(
    (e: React.MouseEvent) => {
      dragState.current = { startX: e.clientX, startWidth: rightWidth }
      e.preventDefault()
    },
    [rightWidth],
  )

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const s = dragState.current
      if (!s) return
      const delta = s.startX - e.clientX
      const next = Math.min(maxRightWidth, Math.max(minRightWidth, s.startWidth + delta))
      setRightWidth(next)
    }
    const onUp = () => {
      dragState.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [minRightWidth, maxRightWidth])

  return (
    <div className="pro-layout-root">
      <div className="pro-layout-split">
        <div className="pro-layout-main">{left}</div>
        <div
          className="pro-layout-handle"
          onMouseDown={onHandleDown}
          role="separator"
          aria-orientation="vertical"
        />
        <div
          className="pro-layout-panel"
          style={{ width: `${rightWidth}px` }}
        >
          <div className="pro-layout-panel-scroll">{right}</div>
        </div>
      </div>
      {footer && <div className="pro-layout-footer">{footer}</div>}
    </div>
  )
}
