import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'

const MIN_THUMB_PX = 44

type Metrics = {
  visible: boolean
  top: number
  height: number
}

type DragState = {
  pointerId: number
  startY: number
  startScrollTop: number
  thumbEl: HTMLDivElement | null
}

const HIDDEN_METRICS: Metrics = {
  visible: false,
  top: 0,
  height: MIN_THUMB_PX,
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.5
}

function sameMetrics(a: Metrics, b: Metrics): boolean {
  return (
    a.visible === b.visible &&
    nearlyEqual(a.top, b.top) &&
    nearlyEqual(a.height, b.height)
  )
}

export default function ResearchScrollRail<T extends HTMLElement>({
  targetRef,
  className,
}: {
  targetRef: RefObject<T | null>
  className?: string
}) {
  const railRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const metricsRef = useRef<Metrics>(HIDDEN_METRICS)
  const [metrics, setMetrics] = useState<Metrics>(HIDDEN_METRICS)
  const [isDragging, setIsDragging] = useState(false)

  const refresh = useCallback(() => {
    const target = targetRef.current
    const rail = railRef.current
    if (!target || !rail) {
      metricsRef.current = HIDDEN_METRICS
      setMetrics((prev) =>
        sameMetrics(prev, HIDDEN_METRICS) ? prev : HIDDEN_METRICS,
      )
      return
    }

    const maxScroll = target.scrollHeight - target.clientHeight
    const railHeight = rail.clientHeight
    if (maxScroll <= 1 || railHeight <= MIN_THUMB_PX) {
      metricsRef.current = HIDDEN_METRICS
      setMetrics((prev) =>
        sameMetrics(prev, HIDDEN_METRICS) ? prev : HIDDEN_METRICS,
      )
      return
    }

    const thumbHeight = clamp(
      (target.clientHeight / target.scrollHeight) * railHeight,
      MIN_THUMB_PX,
      railHeight,
    )
    const maxTop = Math.max(0, railHeight - thumbHeight)
    const thumbTop =
      maxTop === 0 ? 0 : (target.scrollTop / maxScroll) * maxTop
    const next: Metrics = {
      visible: true,
      top: thumbTop,
      height: thumbHeight,
    }
    metricsRef.current = next
    setMetrics((prev) => (sameMetrics(prev, next) ? prev : next))
  }, [targetRef])

  useEffect(() => {
    const target = targetRef.current
    if (!target) return

    let frame: number | null = null
    let resizeObserver: ResizeObserver | null = null
    const observedChildren = new Set<Element>()

    const syncObservedChildren = () => {
      if (!resizeObserver) return
      for (const child of Array.from(target.children)) {
        if (!observedChildren.has(child)) {
          resizeObserver.observe(child)
          observedChildren.add(child)
        }
      }
      for (const child of Array.from(observedChildren)) {
        if (child.parentElement !== target) {
          resizeObserver.unobserve(child)
          observedChildren.delete(child)
        }
      }
    }

    const schedule = () => {
      if (frame != null) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        frame = null
        syncObservedChildren()
        refresh()
      })
    }

    target.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(schedule)
      resizeObserver.observe(target)
      syncObservedChildren()
    }

    const mutationObserver =
      typeof MutationObserver !== 'undefined'
        ? new MutationObserver(schedule)
        : null
    mutationObserver?.observe(target, {
      childList: true,
      characterData: true,
      subtree: true,
    })

    schedule()

    return () => {
      target.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      mutationObserver?.disconnect()
      resizeObserver?.disconnect()
      if (frame != null) window.cancelAnimationFrame(frame)
    }
  }, [refresh, targetRef])

  const scrollToClientY = useCallback(
    (clientY: number) => {
      const target = targetRef.current
      const rail = railRef.current
      if (!target || !rail || !metrics.visible) return

      const maxScroll = target.scrollHeight - target.clientHeight
      const maxTop = rail.clientHeight - metrics.height
      if (maxScroll <= 0 || maxTop <= 0) return

      const railRect = rail.getBoundingClientRect()
      const nextTop = clamp(
        clientY - railRect.top - metrics.height / 2,
        0,
        maxTop,
      )
      target.scrollTop = (nextTop / maxTop) * maxScroll
    },
    [metrics.height, metrics.visible, targetRef],
  )

  const handleRailPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return
      event.preventDefault()
      scrollToClientY(event.clientY)
    },
    [scrollToClientY],
  )

  const handleThumbPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const target = targetRef.current
      if (!target || !metrics.visible) return

      event.preventDefault()
      event.stopPropagation()
      if (typeof event.currentTarget.setPointerCapture === 'function') {
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          // Electron/Chromium can reject capture if the pointer is already gone.
        }
      }
      dragRef.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startScrollTop: target.scrollTop,
        thumbEl: event.currentTarget,
      }
      setIsDragging(true)
    },
    [metrics.visible, targetRef],
  )

  const endDrag = useCallback((pointerId?: number) => {
    const drag = dragRef.current
    if (!drag || (pointerId != null && pointerId !== drag.pointerId)) return

    if (
      drag.thumbEl &&
      typeof drag.thumbEl.releasePointerCapture === 'function' &&
      drag.thumbEl.hasPointerCapture?.(drag.pointerId)
    ) {
      try {
        drag.thumbEl.releasePointerCapture(drag.pointerId)
      } catch {
        // Capture may already have been released by the browser.
      }
    }

    dragRef.current = null
    setIsDragging(false)
  }, [])

  useEffect(() => {
    if (!isDragging) return

    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current
      const target = targetRef.current
      const rail = railRef.current
      const currentMetrics = metricsRef.current
      if (
        !drag ||
        !target ||
        !rail ||
        !currentMetrics.visible ||
        event.pointerId !== drag.pointerId
      ) {
        return
      }

      event.preventDefault()
      const maxScroll = target.scrollHeight - target.clientHeight
      const maxTop = rail.clientHeight - currentMetrics.height
      if (maxScroll <= 0 || maxTop <= 0) return

      const deltaY = event.clientY - drag.startY
      target.scrollTop = clamp(
        drag.startScrollTop + (deltaY / maxTop) * maxScroll,
        0,
        maxScroll,
      )
    }

    const handlePointerUp = (event: PointerEvent) => {
      endDrag(event.pointerId)
    }

    window.addEventListener('pointermove', handlePointerMove, {
      passive: false,
    })
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [endDrag, isDragging, targetRef])

  return (
    <div
      ref={railRef}
      className={
        'research-card-scroll-rail' +
        (metrics.visible ? '' : ' is-hidden') +
        (isDragging ? ' is-dragging' : '') +
        (className ? ` ${className}` : '')
      }
      aria-hidden="true"
      onPointerDown={handleRailPointerDown}
    >
      <div
        className="research-card-scroll-thumb"
        style={
          {
            '--thumb-top': `${metrics.top}px`,
            '--thumb-height': `${metrics.height}px`,
          } as React.CSSProperties
        }
        onPointerDown={handleThumbPointerDown}
      />
    </div>
  )
}
