import { useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'

type DrawerTab = 'preview' | 'errors' | 'details'

/**
 * Focus-mode keyboard shortcuts for LatexDocumentCard.
 *
 * Registered on `document` in the CAPTURE phase with
 * `stopImmediatePropagation`, so Esc can close the drawer / palette BEFORE
 * the parent CreatorOverlay's window-level Esc listener (which would
 * otherwise close the whole overlay on first press).
 *
 * Bindings:
 *  - Esc                close AI palette, else close drawer
 *  - Ctrl/Cmd+Enter     compile
 *  - Ctrl/Cmd+K         toggle AI palette
 *  - Ctrl/Cmd+Alt+P     toggle Preview drawer
 *  - Ctrl/Cmd+Alt+E     toggle Errors drawer
 */
export function useFocusShortcuts({
  enabled,
  aiOpen,
  setAiOpen,
  drawerTab,
  setDrawerTab,
  compile,
}: {
  enabled: boolean
  aiOpen: boolean
  setAiOpen: Dispatch<SetStateAction<boolean>>
  drawerTab: DrawerTab | null
  setDrawerTab: Dispatch<SetStateAction<DrawerTab | null>>
  compile: () => Promise<void>
}) {
  useEffect(() => {
    if (!enabled) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (aiOpen) {
          setAiOpen(false)
          e.stopImmediatePropagation()
          return
        }
        if (drawerTab !== null) {
          setDrawerTab(null)
          e.stopImmediatePropagation()
          return
        }
        return
      }
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      if (e.key === 'Enter') {
        e.preventDefault()
        void compile()
        return
      }
      // Ctrl/Cmd+K: toggle AI palette.
      if (!e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setAiOpen((v) => !v)
        return
      }
      // Ctrl/Cmd+Alt+P / +E: toggle Preview / Errors drawer.
      if (e.altKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault()
        setDrawerTab((t) => (t === 'preview' ? null : 'preview'))
        return
      }
      if (e.altKey && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault()
        setDrawerTab((t) => (t === 'errors' ? null : 'errors'))
        return
      }
    }
    document.addEventListener('keydown', handler, { capture: true })
    return () =>
      document.removeEventListener('keydown', handler, { capture: true })
  }, [enabled, aiOpen, drawerTab, compile, setAiOpen, setDrawerTab])
}
