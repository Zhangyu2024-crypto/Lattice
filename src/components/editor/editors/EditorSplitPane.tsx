import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Resizer from '../../common/Resizer'

const SPLITTER_PX = 6

function readStoredNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    const n = Number.parseInt(raw, 10)
    return Number.isFinite(n) && n > 0 ? n : fallback
  } catch {
    return fallback
  }
}

interface Props {
  storageKey: string
  defaultLeftWidth: number
  minLeftWidth: number
  minRightWidth: number
  label?: string
  left: ReactNode
  right: ReactNode
}

export default function EditorSplitPane({
  storageKey,
  defaultLeftWidth,
  minLeftWidth,
  minRightWidth,
  label = 'Resize split pane',
  left,
  right,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [leftWidthDraft, setLeftWidthDraft] = useState(() =>
    readStoredNumber(storageKey, defaultLeftWidth),
  )

  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const measure = () => {
      setContainerWidth(Math.round(node.getBoundingClientRect().width))
    }
    measure()
    const ro = new ResizeObserver(() => measure())
    ro.observe(node)
    return () => ro.disconnect()
  }, [])

  const maxLeftWidth = useMemo(() => {
    if (containerWidth <= 0) return defaultLeftWidth
    return Math.max(
      minLeftWidth,
      containerWidth - minRightWidth - SPLITTER_PX,
    )
  }, [containerWidth, defaultLeftWidth, minLeftWidth, minRightWidth])

  const leftWidth = Math.round(
    Math.max(minLeftWidth, Math.min(leftWidthDraft, maxLeftWidth)),
  )

  useEffect(() => {
    if (leftWidthDraft !== leftWidth) {
      setLeftWidthDraft(leftWidth)
    }
  }, [leftWidth, leftWidthDraft])

  const persistWidth = (next: number) => {
    try {
      localStorage.setItem(storageKey, String(next))
    } catch {
      // Best-effort only.
    }
  }

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        display: 'flex',
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          flex: '0 0 auto',
          width: leftWidth,
          minWidth: minLeftWidth,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {left}
      </div>
      <Resizer
        orientation="vertical"
        value={leftWidth}
        min={minLeftWidth}
        max={maxLeftWidth}
        onDraft={setLeftWidthDraft}
        onCommit={(next) => {
          setLeftWidthDraft(next)
          persistWidth(next)
        }}
        resetTo={defaultLeftWidth}
        label={label}
      />
      <div
        style={{
          flex: 1,
          minWidth: minRightWidth,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {right}
      </div>
    </div>
  )
}
