import { useEffect } from 'react'

/**
 * Run `onEscape` when the user presses the Escape key. Attached as a
 * `window` listener so modal backdrops / inputs don't need to be focused
 * for it to fire. The listener is mounted only while `enabled` is true —
 * pass `open` for modals that exist conditionally.
 *
 * Extracted so every dialog in the app has consistent close semantics
 * without re-writing the same useEffect boilerplate in each one.
 */
export function useEscapeKey(onEscape: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onEscape()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onEscape, enabled])
}
