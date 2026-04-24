import type { MouseEvent } from 'react'
import {
  Activity,
  Atom,
  File,
  FileCode,
  FileText,
  LineChart,
  ListChecks,
  MessageSquare,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { fileKindFromName } from '../../lib/workspace/file-kind'
import type { LatticeFileKind } from '../../lib/workspace/fs/types'
import type { EditorGroup } from '../../stores/editor-store'

interface Props {
  group: EditorGroup
  isActiveGroup: boolean
  dirtyMap: Record<string, boolean>
  onSelectTab: (relPath: string) => void
  onCloseTab: (relPath: string) => void
  onFocusGroup: () => void
}

function basenameOf(relPath: string): string {
  return relPath.split('/').pop() ?? relPath
}

function kindIcon(kind: LatticeFileKind) {
  const common = { size: 14, strokeWidth: 1.6 }
  switch (kind) {
    case 'spectrum':
      return <LineChart {...common} />
    case 'chat':
      return <MessageSquare {...common} />
    case 'peakfit':
    case 'xrd':
    case 'xps':
    case 'raman':
    case 'curve':
      return <Activity {...common} />
    case 'workbench':
      return <SlidersHorizontal {...common} />
    case 'cif':
      return <Atom {...common} />
    case 'script':
      return <FileCode {...common} />
    case 'markdown':
      return <FileText {...common} />
    case 'job':
      return <ListChecks {...common} />
    default:
      return <File {...common} />
  }
}

export default function EditorTabStrip({
  group,
  isActiveGroup,
  dirtyMap,
  onSelectTab,
  onCloseTab,
  onFocusGroup,
}: Props) {
  const requestClose = (relPath: string) => {
    if (dirtyMap[relPath]) {
      const ok = window.confirm(
        `${basenameOf(relPath)} has unsaved changes. Discard them?`,
      )
      if (!ok) return
    }
    onCloseTab(relPath)
  }

  const handleAuxClick = (e: MouseEvent<HTMLDivElement>, relPath: string) => {
    // Middle-click closes the tab (VSCode parity).
    if (e.button === 1) {
      e.preventDefault()
      requestClose(relPath)
    }
  }

  return (
    <div
      className="editor-tab-strip"
      role="tablist"
      onMouseDown={onFocusGroup}
    >
      {group.tabs.length === 0 ? (
        <div className="editor-tab-strip-empty">(no open files)</div>
      ) : (
        group.tabs.map((relPath) => {
          const active = group.activeTab === relPath
          const dirty = dirtyMap[relPath]
          const kind = fileKindFromName(basenameOf(relPath))
          const tabClass = [
            'editor-tab',
            active ? 'is-active' : '',
            active && isActiveGroup ? 'is-active-group' : '',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <div
              key={relPath}
              role="tab"
              aria-selected={active}
              title={relPath}
              className={tabClass}
              onMouseDown={() => {
                onFocusGroup()
                onSelectTab(relPath)
              }}
              onAuxClick={(e) => handleAuxClick(e, relPath)}
            >
              {kindIcon(kind)}
              <span className="editor-tab-label">{basenameOf(relPath)}</span>
              {dirty ? (
                <span
                  aria-label="Unsaved changes"
                  className="editor-tab-dirty"
                />
              ) : null}
              <button
                type="button"
                aria-label={`Close ${basenameOf(relPath)}`}
                className="editor-tab-close"
                onMouseDown={(e) => {
                  e.stopPropagation()
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  requestClose(relPath)
                }}
              >
                <X size={14} strokeWidth={1.6} />
              </button>
            </div>
          )
        })
      )}
    </div>
  )
}
