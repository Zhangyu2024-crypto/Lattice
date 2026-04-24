// Shared hook for "click outside my wrap closes me" popover dismissal.
//
// Before this existed, eight-plus components (TweakButton, ExportButton,
// RunMenu, NewCellMenu, TableActions' inline + compact menus, the
// CellInsertGap / StreamFootCreator dropdowns, AgentComposer's Add
// menu, …) each wrote the same useEffect: mount a `mousedown` window
// listener, check the event's target against a wrap ref, and call the
// dismisser if the target lay outside. Each copy drifted slightly; one
// forgot the cleanup path, another used `click` (too late for our
// menu-item race conditions), a third listened in capture phase.
//
// `mousedown` rather than `click` so the menu closes before any
// descendant `onClick` handler runs — matches VS Code / the rest of
// the design system. `useLayoutEffect` is unnecessary here because we
// only register listeners on state transitions, not during layout.

import { useEffect, type RefObject } from 'react'

/**
 * Close a popover when a `mousedown` fires outside any of the
 * referenced "safe" elements. Listener only mounts while `open` is
 * true so we don't pay the cost when the menu is idle.
 *
 * Call sites fall into two shapes:
 *   1. The trigger button and the popover live inside a single wrap
 *      element. Pass that wrap's ref as `wrapRef`; any click within
 *      (either on the button or in the popover) is exempt.
 *   2. The trigger button is a sibling of a floating popover, e.g. a
 *      chip in the status bar that anchors a menu. Pass the popover's
 *      ref as `wrapRef` AND the trigger's ref as `anchorRef` so a
 *      click on the trigger isn't caught here — the trigger's own
 *      onClick can then toggle cleanly.
 *
 * @param wrapRef - Primary "inside" container — popover content.
 * @param open - Gates listener attachment.
 * @param onClose - Fired with no args when a dismissing click happens.
 * @param anchorRef - Optional: also treat clicks inside this element
 *   as "inside" (for detached-trigger menus).
 */
export function useOutsideClickDismiss(
  wrapRef: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
  anchorRef?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!(e.target instanceof Node)) return
      if (wrapRef.current?.contains(e.target)) return
      if (anchorRef?.current?.contains(e.target)) return
      onClose()
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [open, onClose, wrapRef, anchorRef])
}
