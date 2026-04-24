import { useCallback, useState } from 'react'

interface SelectEvent {
  shift: boolean
  ctrl: boolean
}

interface MultiSelect {
  selected: Set<string>
  anchor: string | null
  handleSelect: (item: string, event: SelectEvent) => void
  selectAll: () => void
  clearSelection: () => void
  isSelected: (item: string) => boolean
}

export function useMultiSelect(flatItems: string[]): MultiSelect {
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [anchor, setAnchor] = useState<string | null>(null)

  const handleSelect = useCallback(
    (item: string, event: SelectEvent) => {
      if (event.shift && anchor) {
        const anchorIdx = flatItems.indexOf(anchor)
        const targetIdx = flatItems.indexOf(item)
        if (anchorIdx >= 0 && targetIdx >= 0) {
          const start = Math.min(anchorIdx, targetIdx)
          const end = Math.max(anchorIdx, targetIdx)
          const range = flatItems.slice(start, end + 1)
          setSelected((prev) => {
            const next = event.ctrl ? new Set(prev) : new Set<string>()
            for (const r of range) next.add(r)
            return next
          })
        }
        return
      }

      if (event.ctrl) {
        setSelected((prev) => {
          const next = new Set(prev)
          if (next.has(item)) next.delete(item)
          else next.add(item)
          return next
        })
        setAnchor(item)
        return
      }

      setSelected(new Set([item]))
      setAnchor(item)
    },
    [flatItems, anchor],
  )

  const selectAll = useCallback(() => {
    setSelected(new Set(flatItems))
    if (flatItems.length > 0) setAnchor(flatItems[0])
  }, [flatItems])

  const clearSelection = useCallback(() => {
    setSelected(new Set())
    setAnchor(null)
  }, [])

  const isSelected = useCallback(
    (item: string) => selected.has(item),
    [selected],
  )

  return { selected, anchor, handleSelect, selectAll, clearSelection, isSelected }
}
