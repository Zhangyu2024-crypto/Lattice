// Tooltip — zero-dependency Radix-style tooltip.
// Exposes a hook `useTooltip(ref, label)` that returns:
//   - `bind`: event handlers to spread on the anchor element
//   - `portal`: a React node to place inline with the anchor (renders
//               a fixed-position tooltip bubble via Portal)
//
// Positioning strategy: compute at open-time from the anchor's
// getBoundingClientRect; place the bubble above the anchor if there's
// room, otherwise below. No flip-animation — Linear uses instant
// reposition on scroll which we intentionally don't handle (scroll is
// rare in tooltip lifetime; if it happens, the tooltip hides).

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

const OPEN_DELAY_MS = 350
const CLOSE_DELAY_MS = 80

interface TooltipState {
  open: boolean
  x: number
  y: number
  placement: 'top' | 'bottom'
}

export function useTooltip(
  anchorRef: React.RefObject<HTMLElement | null>,
  label: string,
) {
  const [state, setState] = useState<TooltipState>({
    open: false,
    x: 0,
    y: 0,
    placement: 'top',
  })
  const openTimerRef = useRef<number | null>(null)
  const closeTimerRef = useRef<number | null>(null)

  const clearTimers = useCallback(() => {
    if (openTimerRef.current !== null) {
      clearTimeout(openTimerRef.current)
      openTimerRef.current = null
    }
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  useEffect(() => clearTimers, [clearTimers])

  const compute = useCallback((): { x: number; y: number; placement: 'top' | 'bottom' } | null => {
    const el = anchorRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const gap = 6
    const estimatedHeight = 24
    const topFits = rect.top > estimatedHeight + gap + 4
    if (topFits) {
      return {
        x: rect.left + rect.width / 2,
        y: rect.top - gap,
        placement: 'top',
      }
    }
    return {
      x: rect.left + rect.width / 2,
      y: rect.bottom + gap,
      placement: 'bottom',
    }
  }, [anchorRef])

  const scheduleOpen = useCallback(() => {
    clearTimers()
    openTimerRef.current = window.setTimeout(() => {
      const pos = compute()
      if (pos) setState({ open: true, ...pos })
    }, OPEN_DELAY_MS)
  }, [clearTimers, compute])

  const scheduleClose = useCallback(() => {
    clearTimers()
    closeTimerRef.current = window.setTimeout(() => {
      setState((s) => ({ ...s, open: false }))
    }, CLOSE_DELAY_MS)
  }, [clearTimers])

  const bind = {
    onMouseEnter: scheduleOpen,
    onFocus: scheduleOpen,
    onMouseLeave: scheduleClose,
    onBlur: scheduleClose,
  }

  const portal = state.open && typeof document !== 'undefined'
    ? createPortal(
        <TooltipBubble
          x={state.x}
          y={state.y}
          placement={state.placement}
          label={label}
        />,
        document.body,
      )
    : null

  return { bind, portal }
}

function TooltipBubble({
  x,
  y,
  placement,
  label,
}: {
  x: number
  y: number
  placement: 'top' | 'bottom'
  label: string
}) {
  // Translate so the bubble is centred horizontally on the anchor, and
  // either sits above (y is the anchor's top-edge-offset) or below.
  const style: React.CSSProperties = {
    left: x,
    top: y,
    transform:
      placement === 'top'
        ? 'translate(-50%, -100%)'
        : 'translate(-50%, 0)',
  }
  return (
    <div role="tooltip" className="ui-tooltip" data-open="true" style={style}>
      {label}
    </div>
  )
}
