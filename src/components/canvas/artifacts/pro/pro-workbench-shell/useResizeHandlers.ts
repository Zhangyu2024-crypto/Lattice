// Mouse-drag plumbing for the Pro Workbench shell's inspector (vertical
// divider, right edge) and data-tabs (horizontal divider, bottom of the
// main column). Extracted from ProWorkbenchShell.tsx to isolate the
// window-level event wiring from the layout markup.
//
// Behaviour is intentionally identical to the inline version: mousedown
// on a divider captures the start position + current size, mousemove
// clamps the new size between min/max, mouseup clears the drag state.
// Both drags share a single window-level listener pair.

import { useCallback, useEffect, useRef } from 'react'
import type React from 'react'

interface Options {
  inspectorWidth: number
  setInspectorWidth: (next: number) => void
  minInspectorWidth: number
  maxInspectorWidth: number
  dataTabsHeight: number
  setDataTabsHeight: (next: number) => void
  minDataTabsHeight: number
  maxDataTabsHeight: number
}

interface Handlers {
  onInspectorDown: (e: React.MouseEvent) => void
  onDataDown: (e: React.MouseEvent) => void
}

export function useResizeHandlers({
  inspectorWidth,
  setInspectorWidth,
  minInspectorWidth,
  maxInspectorWidth,
  dataTabsHeight,
  setDataTabsHeight,
  minDataTabsHeight,
  maxDataTabsHeight,
}: Options): Handlers {
  const inspectorDrag = useRef<
    { startX: number; startWidth: number } | null
  >(null)
  const dataDrag = useRef<{ startY: number; startHeight: number } | null>(null)

  const onInspectorDown = useCallback(
    (e: React.MouseEvent) => {
      inspectorDrag.current = {
        startX: e.clientX,
        startWidth: inspectorWidth,
      }
      e.preventDefault()
    },
    [inspectorWidth],
  )

  const onDataDown = useCallback(
    (e: React.MouseEvent) => {
      dataDrag.current = {
        startY: e.clientY,
        startHeight: dataTabsHeight,
      }
      e.preventDefault()
    },
    [dataTabsHeight],
  )

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (inspectorDrag.current) {
        // The right pane sits at the right edge; a drag to the left
        // widens it.
        const delta = inspectorDrag.current.startX - e.clientX
        const next = Math.min(
          maxInspectorWidth,
          Math.max(
            minInspectorWidth,
            inspectorDrag.current.startWidth + delta,
          ),
        )
        setInspectorWidth(next)
      }
      if (dataDrag.current) {
        // Data tabs sit at the bottom of the middle row; a drag up
        // grows them.
        const delta = dataDrag.current.startY - e.clientY
        const next = Math.min(
          maxDataTabsHeight,
          Math.max(
            minDataTabsHeight,
            dataDrag.current.startHeight + delta,
          ),
        )
        setDataTabsHeight(next)
      }
    }
    const onUp = () => {
      inspectorDrag.current = null
      dataDrag.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    // Deps mirror the original inline effect — setters come from
    // `usePersistedPanelSize` and are stable across renders, so we
    // intentionally omit them to keep re-subscription cadence identical
    // to the pre-extract version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    maxInspectorWidth,
    minInspectorWidth,
    maxDataTabsHeight,
    minDataTabsHeight,
  ])

  return { onInspectorDown, onDataDown }
}
