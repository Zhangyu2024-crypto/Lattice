import {
  useCallback,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'

/**
 * Seeded + clamped drawer width plus splitter pointer/double-click handlers
 * for the focus-variant drawer. The drawer hugs the right edge — dragging
 * LEFT widens it, dragging RIGHT shrinks it. The editor reserves 320px so
 * it never collapses to a single-column strip.
 */
export function useDrawerResize(bodyRef: RefObject<HTMLDivElement | null>) {
  // Seed from the viewport so small windows don't get an oversize drawer.
  const [drawerWidth, setDrawerWidth] = useState(() => {
    if (typeof window === 'undefined') return 520
    return Math.min(640, Math.max(360, Math.round(window.innerWidth * 0.46)))
  })

  const resizeStateRef = useRef<{
    startX: number
    startWidth: number
  } | null>(null)

  const onSplitterPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      resizeStateRef.current = { startX: e.clientX, startWidth: drawerWidth }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [drawerWidth],
  )
  const onSplitterPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const state = resizeStateRef.current
      if (!state) return
      const body = bodyRef.current
      const bodyWidth = body?.getBoundingClientRect().width ?? 1400
      const next = state.startWidth - (e.clientX - state.startX)
      const max = Math.max(320, bodyWidth - 320)
      setDrawerWidth(Math.max(280, Math.min(max, next)))
    },
    [bodyRef],
  )
  const onSplitterPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
      resizeStateRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    },
    [],
  )
  const onSplitterDoubleClick = useCallback(() => {
    if (typeof window !== 'undefined') {
      setDrawerWidth(
        Math.min(640, Math.max(360, Math.round(window.innerWidth * 0.46))),
      )
    }
  }, [])

  return {
    drawerWidth,
    onSplitterPointerDown,
    onSplitterPointerMove,
    onSplitterPointerUp,
    onSplitterDoubleClick,
  }
}
