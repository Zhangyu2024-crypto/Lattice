import { useRef, type KeyboardEvent, type ReactNode } from 'react'

export interface SegmentedOption<T extends string = string> {
  value: T
  label: string
  icon?: ReactNode
  /** Tooltip; also surfaced as the button's accessible name suffix. */
  title?: string
  /**
   * Per-option accessible name override. Use this when the visible label
   * is terse ("Agent" / "Details") and the screen-reader announcement
   * needs more context ("Agent chat and timeline"). If omitted,
   * the visible `label` is the accessible name.
   */
  ariaLabel?: string
}

interface Props<T extends string = string> {
  options: Array<SegmentedOption<T>>
  value: T
  onChange: (value: T) => void
  /** Accessible name for the whole group. */
  ariaLabel?: string
}

/**
 * A mode-switcher segmented control.
 *
 * Implemented as a `radiogroup` rather than a `tablist` because the control
 * changes an application mode (Dialog vs Agent composer) rather than
 * revealing a distinct tab panel. This matches ARIA 1.2 guidance and keeps
 * assistive tech output coherent ("radio button, Dialog, selected, 1 of 2").
 *
 * Keyboard: ← / → cycles selection, wrapping at the ends.
 */
export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: Props<T>) {
  if (options.length === 0) return null

  const currentIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  )

  // Refs to each radio button, indexed by option position. Used to move DOM
  // focus to the newly-selected option after an arrow keypress so the roving
  // tabindex pattern is complete (otherwise focus stays on the now-tabIndex=-1
  // element and a follow-up Space activates the wrong row).
  const radioRefs = useRef<Array<HTMLButtonElement | null>>([])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const delta = event.key === 'ArrowRight' ? 1 : -1
    const nextIndex = (currentIndex + delta + options.length) % options.length
    onChange(options[nextIndex].value)
    // Defer focus until after onChange's render so the new radio's tabIndex
    // is already 0 — focusing a tabIndex=-1 button works but rapid arrow
    // presses then read the wrong "current" element back.
    queueMicrotask(() => radioRefs.current[nextIndex]?.focus())
  }

  return (
    <div
      className="panel-segmented"
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
    >
      {options.map((option, index) => {
        const checked = option.value === value
        return (
          <button
            key={option.value}
            ref={(el) => {
              radioRefs.current[index] = el
            }}
            type="button"
            role="radio"
            className={`panel-segmented-tab${checked ? ' active' : ''}`}
            aria-checked={checked}
            // Roving tabindex: only the selected radio is in the tab order,
            // arrow keys move between options within the group.
            tabIndex={checked ? 0 : -1}
            title={option.title}
            // Explicit aria-label wins over the visible label for the
            // accessible name, so terse labels can still carry a rich
            // announcement for assistive tech.
            aria-label={option.ariaLabel}
            onClick={() => onChange(option.value)}
          >
            {option.icon}
            <span>{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
