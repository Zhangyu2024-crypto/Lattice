import { useCallback, useRef } from 'react'

/**
 * Returns a stable function reference whose body always delegates to the
 * latest callback passed in. Useful for event listeners registered via
 * `window.addEventListener` / `document.addEventListener` from an effect
 * when you want to bind the handler exactly once (empty deps array) but
 * still read fresh state from the enclosing component.
 *
 * Pattern mirrors the handler-ref trick shipped in Sprint 1 DragOverlay —
 * instead of re-registering the listener whenever the callback's closure
 * changes, we pin the listener and route through a ref that is kept fresh
 * by direct assignment on every render.
 *
 * Equivalent to an internal implementation of the React 19 `useEvent`
 * proposal; kept local so we don't depend on the unreleased hook.
 */
export function useStableCallback<Args extends unknown[], Return>(
  callback: (...args: Args) => Return,
): (...args: Args) => Return {
  const ref = useRef(callback)
  // Assign on every render (not inside useEffect) so handlers that fire
  // synchronously in the same commit as a state change still see the new
  // closure. useEffect would lag by one commit.
  ref.current = callback
  return useCallback((...args: Args) => ref.current(...args), [])
}

export default useStableCallback
