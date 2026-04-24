import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'

const DRAG_THRESHOLD_PX = 4

type DragState = {
  pointerId: number
  startX: number
  startY: number
  startScrollLeft: number
  startScrollTop: number
  moved: boolean
  captureEl: HTMLDivElement | null
}

function shouldIgnoreGrab(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(
    target.closest(
      [
        'a',
        'button',
        'input',
        'textarea',
        'select',
        'option',
        'label',
        'summary',
        '[role="button"]',
        '[data-grab-scroll="ignore"]',
        '.research-card-cite-pill',
      ].join(', '),
    ),
  )
}

export function useGrabScroll<T extends HTMLDivElement>(
  targetRef: RefObject<T | null>,
) {
  const dragRef = useRef<DragState | null>(null)
  const suppressClickRef = useRef(false)
  const [isDragging, setIsDragging] = useState(false)

  const releaseCapture = useCallback((drag: DragState | null) => {
    if (
      drag?.captureEl &&
      typeof drag.captureEl.releasePointerCapture === 'function' &&
      drag.captureEl.hasPointerCapture?.(drag.pointerId)
    ) {
      try {
        drag.captureEl.releasePointerCapture(drag.pointerId)
      } catch {
        // Electron/Chromium may have already released capture.
      }
    }
  }, [])

  const endDrag = useCallback(
    (pointerId?: number) => {
      const drag = dragRef.current
      if (!drag || (pointerId != null && pointerId !== drag.pointerId)) return
      releaseCapture(drag)
      dragRef.current = null
      setIsDragging(false)
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
    },
    [releaseCapture],
  )

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current
      const target = targetRef.current
      if (!drag || !target || event.pointerId !== drag.pointerId) return

      const deltaX = event.clientX - drag.startX
      const deltaY = event.clientY - drag.startY
      if (
        !drag.moved &&
        Math.hypot(deltaX, deltaY) >= DRAG_THRESHOLD_PX
      ) {
        drag.moved = true
        suppressClickRef.current = true
        setIsDragging(true)
      }
      if (!drag.moved) return

      event.preventDefault()
      target.scrollLeft = drag.startScrollLeft - deltaX
      target.scrollTop = drag.startScrollTop - deltaY
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
  }, [endDrag, targetRef])

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<T>) => {
      const target = targetRef.current
      if (!target || event.button !== 0 || shouldIgnoreGrab(event.target)) {
        return
      }

      const canScrollY = target.scrollHeight > target.clientHeight + 1
      const canScrollX = target.scrollWidth > target.clientWidth + 1
      if (!canScrollX && !canScrollY) return

      event.preventDefault()
      if (typeof event.currentTarget.setPointerCapture === 'function') {
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          // Ignore capture failures; global listeners still keep drag alive.
        }
      }

      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startScrollLeft: target.scrollLeft,
        startScrollTop: target.scrollTop,
        moved: false,
        captureEl: event.currentTarget,
      }
      suppressClickRef.current = false
      setIsDragging(false)
    },
    [targetRef],
  )

  const handleClickCapture = useCallback(
    (event: React.MouseEvent<T>) => {
      if (!suppressClickRef.current) return
      event.preventDefault()
      event.stopPropagation()
      suppressClickRef.current = false
    },
    [],
  )

  return {
    isDragging,
    dragBind: {
      onPointerDown: handlePointerDown,
      onClickCapture: handleClickCapture,
    },
  }
}
