// A small, opinionated right-click context menu.
//
// Used today by canvas artifact tables to expose a single "Mention in chat"
// action (MP-3, Canvas → composer reverse-injection). The API is deliberately
// minimal — a controlled `open` flag, viewport coordinates, and a flat list
// of items — so callers don't have to build a menu from scratch each time.
//
// Behaviour:
//   - Rendered through a portal attached to `document.body` so the menu is
//     never clipped by an ancestor with `overflow: hidden` or `transform`
//     (common inside canvas cards).
//   - Fixed-position against the viewport using the {x, y} the caller hands
//     in (usually event.clientX / event.clientY from onContextMenu).
//   - Auto-mirrors against the right / bottom edge of the viewport so the
//     menu never renders off-screen.
//   - Keyboard: ArrowUp / ArrowDown move the active row; Enter invokes it;
//     Escape closes. mousedown outside the menu closes.
//   - First item is highlighted by default — the common case is a single
//     action, so hitting Enter immediately feels natural.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

export interface ContextMenuItem {
  label: string
  onClick: () => void
  icon?: ReactNode
  /** Optional — rows flagged as disabled can't be activated but still render. */
  disabled?: boolean
}

interface Props {
  open: boolean
  /** Viewport-relative coordinates (event.clientX / event.clientY). */
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

// Approximate menu width. Matches the CSS min-width so edge-mirror math lines
// up with the rendered box without forcing an extra layout pass.
const MENU_WIDTH_ESTIMATE = 180
const MENU_ITEM_HEIGHT = 28
const MENU_VERTICAL_PADDING = 8
const VIEWPORT_MARGIN = 6

export default function ContextMenu({ open, x, y, items, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [adjusted, setAdjusted] = useState<{ left: number; top: number }>({
    left: x,
    top: y,
  })

  // Reset active row each time the menu reopens so the user always starts at
  // the first row regardless of how the previous instance was navigated.
  useEffect(() => {
    if (open) setActiveIndex(0)
  }, [open, items])

  // Adjust the menu position against the viewport before paint. We estimate
  // the height from the item count to avoid a visible one-frame jump; the
  // real rendered size is usually within a pixel or two.
  useLayoutEffect(() => {
    if (!open) return
    const estHeight =
      MENU_VERTICAL_PADDING * 2 + items.length * MENU_ITEM_HEIGHT
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = x
    let top = y
    if (left + MENU_WIDTH_ESTIMATE + VIEWPORT_MARGIN > vw) {
      left = Math.max(VIEWPORT_MARGIN, vw - MENU_WIDTH_ESTIMATE - VIEWPORT_MARGIN)
    }
    if (top + estHeight + VIEWPORT_MARGIN > vh) {
      top = Math.max(VIEWPORT_MARGIN, vh - estHeight - VIEWPORT_MARGIN)
    }
    setAdjusted({ left, top })
  }, [open, x, y, items.length])

  const invokeActive = useCallback(() => {
    const item = items[activeIndex]
    if (!item || item.disabled) return
    item.onClick()
    onClose()
  }, [items, activeIndex, onClose])

  // Document-level listeners for keyboard + outside click. Mounted only while
  // the menu is open so we don't interfere with the rest of the app.
  useEffect(() => {
    if (!open) return

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (items.length === 0) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((i) => {
          for (let step = 1; step <= items.length; step++) {
            const next = (i + step) % items.length
            if (!items[next].disabled) return next
          }
          return i
        })
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((i) => {
          for (let step = 1; step <= items.length; step++) {
            const next = (i - step + items.length) % items.length
            if (!items[next].disabled) return next
          }
          return i
        })
      } else if (e.key === 'Enter') {
        e.preventDefault()
        invokeActive()
      }
    }

    const handleMouseDown = (e: MouseEvent) => {
      const el = menuRef.current
      if (!el) return
      if (e.target instanceof Node && el.contains(e.target)) return
      onClose()
    }

    // `mousedown` (not `click`) so the menu closes before any downstream
    // handler runs — matches VS Code's feel and avoids accidental re-opens
    // when the user right-clicks elsewhere.
    window.addEventListener('keydown', handleKey)
    window.addEventListener('mousedown', handleMouseDown, true)
    // Close on viewport resize / scroll — the anchor coordinates are stale
    // once the page layout shifts.
    const handleDismiss = () => onClose()
    window.addEventListener('resize', handleDismiss)
    window.addEventListener('scroll', handleDismiss, true)
    return () => {
      window.removeEventListener('keydown', handleKey)
      window.removeEventListener('mousedown', handleMouseDown, true)
      window.removeEventListener('resize', handleDismiss)
      window.removeEventListener('scroll', handleDismiss, true)
    }
  }, [open, items, onClose, invokeActive])

  if (!open || items.length === 0) return null
  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={menuRef}
      className="context-menu context-menu-anchor"
      role="menu"
      style={
        {
          '--ctx-left': `${adjusted.left}px`,
          '--ctx-top': `${adjusted.top}px`,
        } as React.CSSProperties
      }
      // Stop context-menu chaining: a right-click *on* our menu shouldn't
      // open another native menu on top.
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, idx) => {
        const isActive = idx === activeIndex
        const className =
          'context-menu-item' +
          (isActive ? ' is-active' : '') +
          (item.disabled ? ' is-disabled' : '')
        return (
          <button
            key={`${item.label}-${idx}`}
            type="button"
            role="menuitem"
            className={className}
            disabled={item.disabled}
            onMouseEnter={() => !item.disabled && setActiveIndex(idx)}
            onClick={() => {
              if (item.disabled) return
              item.onClick()
              onClose()
            }}
          >
            {item.icon !== undefined && (
              <span className="context-menu-icon" aria-hidden>
                {item.icon}
              </span>
            )}
            <span className="context-menu-label">{item.label}</span>
          </button>
        )
      })}
    </div>,
    document.body,
  )
}
