import { useMemo } from 'react'
import {
  useEditorStore,
  type EditorGroup as EditorGroupModel,
} from '../../stores/editor-store'
import EditorTabStrip from './EditorTabStrip'
import FileEditor from './FileEditor'

interface Props {
  group: EditorGroupModel
  isActiveGroup: boolean
}

export default function EditorGroup({ group, isActiveGroup }: Props) {
  const openFiles = useEditorStore((s) => s.openFiles)
  const closeFile = useEditorStore((s) => s.closeFile)
  const setActiveTab = useEditorStore((s) => s.setActiveTab)
  const setActiveGroup = useEditorStore((s) => s.setActiveGroup)

  const dirtyMap = useMemo(() => {
    const m: Record<string, boolean> = {}
    for (const relPath of group.tabs) {
      m[relPath] = openFiles[relPath]?.dirty ?? false
    }
    return m
  }, [group.tabs, openFiles])

  const activeRel = group.activeTab

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        minHeight: 0,
        height: '100%',
        background: 'var(--editor-bg, #1a1a1a)',
      }}
    >
      <EditorTabStrip
        group={group}
        isActiveGroup={isActiveGroup}
        dirtyMap={dirtyMap}
        onSelectTab={(rel) => setActiveTab(group.id, rel)}
        onCloseTab={(rel) => closeFile(rel, group.id)}
        onFocusGroup={() => setActiveGroup(group.id)}
      />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          position: 'relative',
        }}
        onMouseDown={() => setActiveGroup(group.id)}
      >
        {activeRel ? (
          <FileEditor key={activeRel} relPath={activeRel} />
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              fontSize: "var(--text-sm)",
              color: 'var(--fg-muted, #777)',
            }}
          >
            Open a file from the Explorer to start editing
          </div>
        )}
      </div>
    </div>
  )
}
