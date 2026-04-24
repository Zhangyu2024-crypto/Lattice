import { useEffect } from 'react'
import { useEditorStore } from '../../stores/editor-store'
import EditorGroup from './EditorGroup'
import WelcomePanel from './WelcomePanel'

export default function EditorArea() {
  const groups = useEditorStore((s) => s.groups)
  const activeGroupId = useEditorStore((s) => s.activeGroupId)
  const noOpenTabs = groups.every((g) => g.tabs.length === 0)

  // Global Ctrl/Cmd+S — dispatches to the saver registered by the editor
  // backing the active group's active tab. CodeMirror instances also
  // install their own Mod-s binding so the shortcut works while focused
  // inside the editor; this handler covers the case where focus is in the
  // toolbar, preview pane, or elsewhere in the editor chrome.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isSave = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey
      if (!isSave) return
      if (e.key !== 's' && e.key !== 'S') return
      const state = useEditorStore.getState()
      const activeGroup = state.groups.find((g) => g.id === state.activeGroupId)
      const activeTab = activeGroup?.activeTab
      if (!activeTab) return
      const saver = state.savers[activeTab]
      if (!saver) return
      e.preventDefault()
      e.stopPropagation()
      void saver()
    }
    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
    }
  }, [])

  if (noOpenTabs) {
    return <WelcomePanel />
  }

  const cols = Math.max(1, Math.min(4, groups.length))

  return (
    <div
      style={
        {
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          height: '100%',
          minHeight: 0,
          width: '100%',
          '--split-cols': String(cols),
        } as React.CSSProperties
      }
    >
      {groups.map((g, i) => (
        <div
          key={g.id}
          style={{
            minWidth: 0,
            minHeight: 0,
            height: '100%',
            borderLeft:
              i > 0 ? '1px solid var(--border, #2a2a2a)' : 'none',
          }}
        >
          <EditorGroup group={g} isActiveGroup={g.id === activeGroupId} />
        </div>
      ))}
    </div>
  )
}
