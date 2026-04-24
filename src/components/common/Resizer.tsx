// Resizer — shared drag handle for the shell's inter-column splitters.
// Replaces the 1px same-color-as-border divs scattered across App.tsx
// (which were invisible and gave users no affordance that the app was
// resizable). Four design moves:
//
//   1. The interactive strip is 6 px wide, but the visible line is just
//      1 px — so it doesn't steal space from the UI but is easy to grab.
//   2. Hover pulses the visible line to accent cyan so the user sees
//      which edge they're about to grab before clicking.
//   3. A full-screen overlay is mounted while dragging, forcing the
//      cursor everywhere (ECharts canvas, iframes, etc. normally steal
//      the cursor mid-drag).
//   4. Double-click resets to the caller-supplied default width.
//
// Sprint 3: also a keyboard-operable slider — arrows nudge, Shift+arrow
// steps by 4×, Home / End snap to min / max. ARIA mirrors `role="slider"`
// with live value/orientation so screen readers read the split size.

import { useRef, useState, type KeyboardEvent } from 'react'

interface Props {
  orientation: 'vertical' | 'horizontal'
  /** Persisted width/height — read-only in this component. */
  value: number
  /** Live draft setter fired on every move. */
  onDraft: (next: number) => void
  /** Fired once on mouseup with the final clamped value. */
  onCommit: (final: number) => void
  /** Hard clamps — the component guarantees `min <= value <= max`. */
  min: number
  max: number
  /** When true, dragging towards the lower coordinate *grows* the target
   *  (used for panels anchored to the right / bottom edge). */
  invert?: boolean
  /** Value applied on double-click. Omit to disable double-click reset. */
  resetTo?: number
  /** Accessible label used by the drag overlay's role=separator. */
  label?: string
}

// Arrow-key step sizes. ±8 is roughly one row of typography and feels
// responsive without overshooting the target; Shift escalates to ±32
// which matches "one visual notch" for the sidebar and rail.
const STEP_SMALL = 8
const STEP_LARGE = 32

export default function Resizer({
  orientation,
  value,
  onDraft,
  onCommit,
  min,
  max,
  invert = false,
  resetTo,
  label,
}: Props) {
  const [dragging, setDragging] = useState(false)
  const [hover, setHover] = useState(false)
  // `moved` guards the double-click handler: if the user slightly
  // wiggled the mouse while double-clicking, we don't want a stray
  // `resetTo` on top of a drag commit.
  const movedRef = useRef(false)

  const vertical = orientation === 'vertical'
  const axis: 'clientX' | 'clientY' = vertical ? 'clientX' : 'clientY'
  const bodyCursor = vertical ? 'col-resize' : 'row-resize'

  const clamp = (raw: number) =>
    Math.round(Math.max(min, Math.min(max, raw)))

  const startDrag = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    const start = e[axis]
    const startValue = value
    let finalValue = startValue
    movedRef.current = false

    setDragging(true)
    const onMove = (ev: MouseEvent) => {
      const delta = ev[axis] - start
      const signed = invert ? -delta : delta
      if (Math.abs(delta) > 1) movedRef.current = true
      const next = clamp(startValue + signed)
      finalValue = next
      onDraft(next)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setDragging(false)
      onCommit(finalValue)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = bodyCursor
    document.body.style.userSelect = 'none'
  }

  const handleDoubleClick = () => {
    if (resetTo == null) return
    if (movedRef.current) return
    onDraft(resetTo)
    onCommit(resetTo)
  }

  const applyKeyboardStep = (delta: number) => {
    // `invert` flips the on-screen axis sign (right/bottom-anchored
    // panels grow as the pointer moves toward the anchor). Apply the
    // same flip here so ArrowRight always visually enlarges the "near"
    // edge, regardless of which side owns the Resizer.
    const signed = invert ? -delta : delta
    const next = clamp(value + signed)
    if (next === value) return
    // Mouse drag debounces commit to mouseup; keyboard has no such
    // signal so each keypress is both draft and commit — persisted
    // layout updates immediately and undo history stays granular.
    onDraft(next)
    onCommit(next)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Only handle keys the slider owns; let Tab / modifier combos bubble.
    const step = e.shiftKey ? STEP_LARGE : STEP_SMALL
    const decreaseKey = vertical ? 'ArrowLeft' : 'ArrowUp'
    const increaseKey = vertical ? 'ArrowRight' : 'ArrowDown'
    if (e.key === decreaseKey) {
      e.preventDefault()
      applyKeyboardStep(-step)
    } else if (e.key === increaseKey) {
      e.preventDefault()
      applyKeyboardStep(step)
    } else if (e.key === 'Home') {
      e.preventDefault()
      if (value !== min) {
        onDraft(min)
        onCommit(min)
      }
    } else if (e.key === 'End') {
      e.preventDefault()
      if (value !== max) {
        onDraft(max)
        onCommit(max)
      }
    } else if ((e.key === 'Enter' || e.key === ' ') && resetTo != null) {
      // Keyboard equivalent of the double-click reset — avoids forcing
      // users to mouse back to double-click just to restore defaults.
      e.preventDefault()
      if (value !== resetTo) {
        onDraft(resetTo)
        onCommit(resetTo)
      }
    }
  }

  // Outer strip is 6 px on the resize axis; the inner hairline is 1 px,
  // centred. Hit area is wide, visual is thin — matches VSCode. Styles
  // live in `views.css` under `.resizer-*`; only the hot state is
  // toggled here via `.is-hot` (fired during drag even when not hovering).
  const hot = dragging || hover
  const stripClass =
    'resizer-strip ' +
    (vertical ? 'resizer-strip--vertical' : 'resizer-strip--horizontal') +
    (hot ? ' is-hot' : '')
  const lineClass =
    'resizer-line ' +
    (vertical ? 'resizer-line--vertical' : 'resizer-line--horizontal')

  return (
    <>
      <div
        // ARIA: `role="slider"` — this control maps to a numeric range
        // (panel size in px). Screen readers announce "slider, <label>,
        // <value>". Previously `role="separator"` read as a static
        // landmark; assistive users had no idea they could adjust it.
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-orientation={vertical ? 'vertical' : 'horizontal'}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        onMouseDown={startDrag}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        className={stripClass}
      >
        <div className={lineClass} />
      </div>
      {dragging && <DragShade cursor={bodyCursor} />}
    </>
  )
}

/**
 * Full-viewport transparent overlay that absorbs pointer events while the
 * user is dragging a Resizer. Fixes two issues:
 *
 *   1. ECharts canvas / iframes override `document.body.style.cursor`
 *      mid-drag, so the cursor flickers between col-resize and
 *      default/crosshair. An overlay keeps the cursor pinned.
 *   2. Drag past an iframe and its content's onmouseup fires inside
 *      the iframe, losing our release. The overlay guarantees the
 *      window-level listener hears mouseup first.
 */
function DragShade({ cursor }: { cursor: string }) {
  // Transparent but still event-opaque — we don't render anything visual.
  // A solid fill here would dim the rest of the app, which Linear / Figma
  // deliberately do NOT do. Cursor is passed in because both row- and
  // col-resize must stay pinned even if an iframe steals document.body.
  return (
    <div
      className="resizer-drag-shade"
      style={{ '--shade-cursor': cursor } as React.CSSProperties}
    />
  )
}
