import { useEffect } from 'react'
import { useRuntimeStore } from '../stores/runtime-store'
import { useModalStore } from '../stores/modal-store'
import type { SettingsTabId } from '../components/layout/SettingsModal'
import type { WorkspaceRailTab } from '../components/layout/WorkspaceRail'

export interface AppShortcutsDeps {
  toggleSidebar: () => void
  toggleRightRail: () => void
  openRightRailTab: (tab: WorkspaceRailTab) => void
  toggleSettingsTab: (tab: SettingsTabId) => void
  toggleInspector: () => void
  handleOpenLibrary: () => void
  openFile: () => void
  chatVisible: boolean
  activeWorkspaceRailTab: WorkspaceRailTab
}

/**
 * Global keyboard shortcut dispatcher for the Lattice shell.
 *
 * Binds a single `keydown` listener on `window` and routes to the right
 * handler. One registration site = one place to audit all app-wide
 * shortcuts; component-scoped shortcuts (e.g. textarea autocomplete)
 * stay inside their owning component and are not covered here.
 *
 * Shortcut map:
 *   Ctrl+Shift+P    Command palette
 *   Ctrl+B          Toggle sidebar
 *   Ctrl+L          Toggle right rail (focus agent tab when opening)
 *   Ctrl+O          Open file
 *   Ctrl+,          Settings → Compute tab
 *   Ctrl+Shift+L    Settings → Models tab
 *   Ctrl+Shift+B    Open Library modal
 *   Ctrl+Shift+K    Open Knowledge modal
 *   Ctrl+Shift+I    Toggle Inspector pane
 *   Ctrl+W          Close focused artifact
 *   Ctrl+Shift+N    New session
 *   Escape          Dismiss palette + settings modal
 */
export function useAppShortcuts(deps: AppShortcutsDeps): void {
  const {
    toggleSidebar,
    toggleRightRail,
    openRightRailTab,
    toggleSettingsTab,
    toggleInspector,
    handleOpenLibrary,
    openFile,
    chatVisible,
    activeWorkspaceRailTab,
  } = deps

  useEffect(() => {
    // Modal setters come from the store, not props — the hook used to
    // require them in its deps bag but every caller was forwarding
    // modal-store selectors anyway, which defeated the point.
    const { setPaletteOpen, setSettingsOpen } = useModalStore.getState()
    const handler = (e: KeyboardEvent) => {
      // Normalize the key comparison: `e.key` is affected by CapsLock
      // (returns 'B' when CapsLock is on + Shift is down) which caused the
      // pre-v7 behaviour where Ctrl+B mis-routed into Ctrl+Shift+B branch
      // if the user had CapsLock on. Lower-case once and dispatch from the
      // modifier set (ctrl + shift + alt + meta) explicitly so CapsLock
      // cannot move a key between branches.
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
      const plain = !e.shiftKey && !e.altKey && !e.metaKey
      const shift = e.shiftKey && !e.altKey && !e.metaKey
      if (e.ctrlKey && shift && k === 'p') {
        e.preventDefault()
        setPaletteOpen(!useModalStore.getState().paletteOpen)
      } else if (e.ctrlKey && plain && k === 'b') {
        e.preventDefault()
        toggleSidebar()
      } else if (e.ctrlKey && plain && k === 'l') {
        e.preventDefault()
        if (chatVisible && activeWorkspaceRailTab === 'agent') {
          toggleRightRail()
        } else {
          openRightRailTab('agent')
        }
      } else if (e.ctrlKey && plain && k === 'o') {
        e.preventDefault()
        openFile()
      } else if (e.ctrlKey && plain && k === ',') {
        e.preventDefault()
        toggleSettingsTab('compute')
      } else if (e.ctrlKey && shift && k === 'l') {
        e.preventDefault()
        toggleSettingsTab('models')
      } else if (e.ctrlKey && shift && k === 'b') {
        e.preventDefault()
        handleOpenLibrary()
      } else if (e.ctrlKey && shift && k === 'k') {
        e.preventDefault()
        handleOpenLibrary()
      } else if (e.ctrlKey && shift && k === 'i') {
        e.preventDefault()
        toggleInspector()
      } else if (e.ctrlKey && plain && k === 'w') {
        // Close the currently focused artifact (browser-tab convention).
        const store = useRuntimeStore.getState()
        const sid = store.activeSessionId
        const fid = sid ? store.sessions[sid]?.focusedArtifactId : null
        if (sid && fid) {
          e.preventDefault()
          store.removeArtifact(sid, fid)
        }
      } else if (e.ctrlKey && shift && k === 'n') {
        e.preventDefault()
        const store = useRuntimeStore.getState()
        const id = store.createSession({ title: 'Session 1' })
        store.setActiveSession(id)
      } else if (k === 'Escape') {
        setPaletteOpen(false)
        setSettingsOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [
    activeWorkspaceRailTab,
    chatVisible,
    handleOpenLibrary,
    openFile,
    openRightRailTab,
    toggleInspector,
    toggleRightRail,
    toggleSettingsTab,
    toggleSidebar,
  ])
}
