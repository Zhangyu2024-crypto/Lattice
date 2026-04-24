// Tiny shared React state hook for "which peak is the user currently
// pointing at" in a Pro Workbench DataTab. Each module's `useActions`
// composes this in and exposes the pair via its Actions bag; the peak
// table hands `setIdx` as its `onFocus` prop, and the main viz reads
// `idx` to brighten that marker. Lives as its own module so the
// semantics stay stable across modules.

import { useCallback, useState } from 'react'

export interface FocusedPeakState {
  focusedPeakIdx: number | null
  setFocusedPeakIdx(idx: number | null): void
}

export function useFocusedPeak(): FocusedPeakState {
  const [focusedPeakIdx, setFocusedPeakIdxRaw] = useState<number | null>(null)
  const setFocusedPeakIdx = useCallback((idx: number | null) => {
    // The table fires focus/blur rapidly — coalesce `null → null` and
    // `idx → idx` so we don't thrash `useMemo` caches downstream.
    setFocusedPeakIdxRaw((prev) => (prev === idx ? prev : idx))
  }, [])
  return { focusedPeakIdx, setFocusedPeakIdx }
}
