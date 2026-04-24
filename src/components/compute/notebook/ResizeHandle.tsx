// Shared vertical-drag resize handle for Compute cell sub-panes
// (CodeMirror editor, StructureViewer, console <pre>). Sits directly
// under the target element; listeners attach on mousedown and move
// live on the window during drag — draft on change, commit on release
// so we don't hammer the zustand store on every pixel.
//
// Caller supplies:
//   - `height` (current, in px)
//   - `min` / `max` (clamp bounds)
//   - `onDraft(next)` (live during drag — cheap local-state write)
//   - `onCommit(final)` (once on mouseup — persists to payload)

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'

export interface ResizeHandleProps {
  height: number
  min: number
  max: number
  onDraft: (next: number) => void
  onCommit: (final: number) => void
  /** Accessible label (hover / screen-reader tooltip). */
  label?: string
}

export function ResizeHandle({
  height,
  min,
  max,
  onDraft,
  onCommit,
  label = 'Resize',
}: ResizeHandleProps) {
  const [dragging, setDragging] = useState(false)
  const startY = useRef(0)
  const startH = useRef(0)

  const onMove = useCallback(
    (e: MouseEvent) => {
      const delta = e.clientY - startY.current
      const next = Math.round(
        Math.max(min, Math.min(max, startH.current + delta)),
      )
      onDraft(next)
    },
    [min, max, onDraft],
  )

  const onUp = useCallback(
    (e: MouseEvent) => {
      const delta = e.clientY - startY.current
      const final = Math.round(
        Math.max(min, Math.min(max, startH.current + delta)),
      )
      setDragging(false)
      onCommit(final)
    },
    [min, max, onCommit],
  )

  useEffect(() => {
    if (!dragging) return
    // Use window-level listeners so the drag keeps tracking when the
    // pointer leaves the small handle area. `{capture: true}` keeps
    // child onClick handlers from swallowing the release event on
    // buttons overlapping the drag path.
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp, { once: true })
    // Avoid accidental text selection while dragging a pane edge.
    const prevUserSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = prevUserSelect
    }
  }, [dragging, onMove, onUp])

  return (
    <div
      className={`compute-nb-resize-handle${dragging ? ' is-dragging' : ''}`}
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      title={label}
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        startY.current = e.clientY
        startH.current = height
        setDragging(true)
      }}
    >
      <span className="compute-nb-resize-handle-bar" aria-hidden />
    </div>
  )
}
