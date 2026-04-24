// useRovingTabIndex — directional keyboard nav for module lists
// (LibraryModal paper list, KnowledgeBrowserModal chain list, etc.).
//
// Up/Down move focus between siblings matched by `itemSelector`.
// Home/End jump to the first/last. Disabled while the user is typing
// in an <input>, <textarea>, or [contenteditable] element so search
// boxes keep their arrow-key semantics.

import { useEffect, type RefObject } from 'react'

export function useRovingTabIndex(
  listRef: RefObject<HTMLElement | null>,
  itemSelector: string,
) {
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null
      if (active) {
        const tag = active.tagName
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          active.isContentEditable
        ) {
          return
        }
        if (!list.contains(active)) return
      } else {
        return
      }
      const items = Array.from(
        list.querySelectorAll<HTMLElement>(itemSelector),
      ).filter((el) => !el.hasAttribute('data-roving-skip'))
      if (items.length === 0) return
      const idx = items.indexOf(active as HTMLElement)
      let next = -1
      switch (e.key) {
        case 'ArrowDown':
          next = idx < 0 ? 0 : Math.min(items.length - 1, idx + 1)
          break
        case 'ArrowUp':
          next = idx < 0 ? items.length - 1 : Math.max(0, idx - 1)
          break
        case 'Home':
          next = 0
          break
        case 'End':
          next = items.length - 1
          break
        default:
          return
      }
      if (next < 0 || next >= items.length) return
      e.preventDefault()
      items[next].focus()
    }
    list.addEventListener('keydown', onKey)
    return () => list.removeEventListener('keydown', onKey)
  }, [listRef, itemSelector])
}

export default useRovingTabIndex
