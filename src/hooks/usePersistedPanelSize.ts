// Persist a numeric panel size (px) to `prefs-store` with a debounced
// write so 60fps drag events don't flood localStorage.
//
// Returns a `[value, setValue]` tuple shaped like `useState`; the setter
// updates local React state synchronously (so resizers feel responsive)
// and schedules a store write 150ms after the last change.
//
// Intended usage: `usePersistedPanelSize('proWorkbench.inspectorWidth', 320)`.
// The dotted key is resolved against `prefs.layout.<key>` — the caller
// is responsible for picking a key whose default already lives in
// `DEFAULT_LAYOUT`, otherwise the initial value will fall back to the
// `fallback` arg.

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePrefsStore } from '../stores/prefs-store'
import type { LayoutPrefs, ProWorkbenchLayout } from '../stores/prefs-store'

const WRITE_DEBOUNCE_MS = 150

type ProWorkbenchKey = keyof ProWorkbenchLayout

type PersistedKey =
  | 'sidebarWidth'
  | 'chatWidth'
  | 'inspectorWidth'
  | `proWorkbench.${ProWorkbenchKey}`

function readLayout(layout: LayoutPrefs, key: PersistedKey): number | undefined {
  if (key.startsWith('proWorkbench.')) {
    const leaf = key.slice('proWorkbench.'.length) as ProWorkbenchKey
    const v = layout.proWorkbench?.[leaf]
    return typeof v === 'number' ? v : undefined
  }
  const v = (layout as unknown as Record<string, unknown>)[key]
  return typeof v === 'number' ? v : undefined
}

function makePatch(key: PersistedKey, value: number): Partial<LayoutPrefs> {
  if (key.startsWith('proWorkbench.')) {
    const leaf = key.slice('proWorkbench.'.length) as ProWorkbenchKey
    // Patch merges at the top level, so we have to carry the full
    // sub-object through and let `normalizeLayout` re-clamp.
    const current = usePrefsStore.getState().layout.proWorkbench
    return { proWorkbench: { ...current, [leaf]: value } }
  }
  return { [key]: value } as Partial<LayoutPrefs>
}

/**
 * Persisted numeric panel size hook.
 *
 * @param key      Dotted layout path (see `PersistedKey`).
 * @param fallback Used only when the stored value is missing / invalid.
 */
export function usePersistedPanelSize(
  key: PersistedKey,
  fallback: number,
): [number, (next: number) => void] {
  const stored = usePrefsStore((s) => readLayout(s.layout, key))
  const setLayout = usePrefsStore((s) => s.setLayout)
  const [value, setLocal] = useState<number>(stored ?? fallback)

  // Keep local state in sync when the store changes from some other
  // source (e.g. a reset-to-defaults button). We only clobber the
  // local value when the store diverges from what we last wrote, so
  // the user's in-progress drag isn't interrupted by our own write
  // bouncing back.
  const lastWritten = useRef<number>(stored ?? fallback)
  useEffect(() => {
    if (stored == null) return
    if (stored !== lastWritten.current) {
      setLocal(stored)
      lastWritten.current = stored
    }
  }, [stored])

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<number | null>(null)

  // Flush any pending write on unmount so a rapid drag-then-close of a
  // panel still lands its final size in storage.
  useEffect(() => {
    return () => {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
        if (pendingRef.current != null) {
          const next = pendingRef.current
          lastWritten.current = next
          setLayout(makePatch(key, next))
          pendingRef.current = null
        }
      }
    }
  }, [key, setLayout])

  const setValue = useCallback(
    (next: number) => {
      if (!Number.isFinite(next)) return
      setLocal(next)
      pendingRef.current = next
      if (timerRef.current != null) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        const v = pendingRef.current
        pendingRef.current = null
        if (v == null) return
        lastWritten.current = v
        setLayout(makePatch(key, v))
      }, WRITE_DEBOUNCE_MS)
    },
    [key, setLayout],
  )

  return [value, setValue]
}
