import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import {
  useWorkspaceStore,
  type IndexedEntry,
} from '../../stores/workspace-store'
import { useDataIndexStore } from '../../stores/data-index-store'
import { useEditorStore } from '../../stores/editor-store'
import { useRuntimeStore } from '@/stores/runtime-store'
import { getWorkspaceFs } from '../../lib/workspace/fs'
import { writeEnvelope } from '../../lib/workspace/envelope'
import { activateSessionForFile } from '../../lib/workspace/session-bridge'
import { toast } from '../../stores/toast-store'
import {
  dispatchComposerFocus,
  dispatchMentionAdd,
} from '@/lib/composer-bus'
import ContextMenu from '../common/ContextMenu'
import FileTreeNode from './FileTreeNode'
import { useMultiSelect } from '../../hooks/useMultiSelect'
import PropertiesDialog from './file-tree/PropertiesDialog'
import { posixJoin, syncChatTitleAfterRename } from './file-tree/helpers'
import { buildMenuItems } from './file-tree/buildMenuItems'
import { asyncPrompt } from '../../lib/prompt-dialog'

interface ContextMenuState {
  x: number
  y: number
  target: IndexedEntry | null
}

export default function FileTree() {
  const fileIndex = useWorkspaceStore((s) => s.fileIndex)
  const refreshDir = useWorkspaceStore((s) => s.refreshDir)
  const renameEntry = useWorkspaceStore((s) => s.renameEntry)
  const deleteEntry = useWorkspaceStore((s) => s.deleteEntry)
  const writeFile = useWorkspaceStore((s) => s.writeFile)
  const readFile = useWorkspaceStore((s) => s.readFile)
  const createFolder = useWorkspaceStore((s) => s.createFolder)

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [propertiesTarget, setPropertiesTarget] =
    useState<IndexedEntry | null>(null)
  const openFile = useEditorStore((s) => s.openFile)
  const activeGroupRel = useEditorStore((s) => {
    const active = s.groups.find((g) => g.id === s.activeGroupId)
    return active?.activeTab ?? null
  })

  // Chats are managed through the ChatPanel's Chats dropdown, not the
  // FileTree. Hide both the top-level `chats/` folder and any stray
  // `.chat.json` files from the tree so the workspace view stays focused
  // on data/analysis artifacts. Users who need the file (import/export)
  // can still reach it via the OS file manager.
  const isChatTreeEntry = useCallback((entry: IndexedEntry): boolean => {
    const low = entry.relPath.toLowerCase()
    if (low === 'chats' || low.startsWith('chats/')) return true
    if (low.endsWith('.chat.json')) return true
    return false
  }, [])

  const byParent = useMemo(() => {
    const map = new Map<string, IndexedEntry[]>()
    for (const entry of Object.values(fileIndex)) {
      if (isChatTreeEntry(entry)) continue
      const arr = map.get(entry.parentRel) ?? []
      arr.push(entry)
      map.set(entry.parentRel, arr)
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.localeCompare(b.name)
      })
    }
    return map
  }, [fileIndex, isChatTreeEntry])

  const rootChildren = byParent.get('') ?? []

  const flatVisibleFiles = useMemo(() => {
    const result: string[] = []
    function walk(parentRel: string) {
      for (const entry of byParent.get(parentRel) ?? []) {
        if (!entry.isDirectory) result.push(entry.relPath)
        if (entry.isDirectory && expanded.has(entry.relPath)) walk(entry.relPath)
      }
    }
    walk('')
    return result
  }, [byParent, expanded])

  const multiSelect = useMultiSelect(flatVisibleFiles)
  const treeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = treeRef.current
    if (!el) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault()
        multiSelect.selectAll()
      }
      if (e.key === 'Escape') multiSelect.clearSelection()
      if (e.key === 'Delete' && multiSelect.selected.size > 0) {
        e.preventDefault()
        const files = [...multiSelect.selected]
        const ok = window.confirm(`Delete ${files.length} file(s)?`)
        if (ok) {
          for (const f of files) void deleteEntry(f, true)
          multiSelect.clearSelection()
        }
      }
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [multiSelect, deleteEntry])

  const onToggle = useCallback(
    (rel: string) => {
      setExpanded((prev) => {
        const next = new Set(prev)
        if (next.has(rel)) {
          next.delete(rel)
        } else {
          next.add(rel)
          if (!byParent.has(rel)) void refreshDir(rel)
        }
        return next
      })
    },
    [byParent, refreshDir],
  )

  const onOpen = useCallback(
    (entry: IndexedEntry) => {
      if (entry.isDirectory) return
      const name = entry.name.toLowerCase()
      if (name.endsWith('.pdf')) {
        void (
          window as unknown as {
            electronAPI?: {
              openPdfReaderWindow?: (r: string) => Promise<unknown>
            }
          }
        ).electronAPI?.openPdfReaderWindow?.(entry.relPath)
        return
      }
      openFile(entry.relPath)
    },
    [openFile],
  )

  // Bare single-click on `.chat.json`: activate the backing session in
  // runtime-store (hydrating from the envelope if it's the first open) and
  // leave the editor area untouched. Double-click / right-click "Open" still
  // go through `onOpen` above, which routes to `ChatFileEditor` for a
  // read-only transcript inspection.
  const enterChat = useCallback((relPath: string) => {
    void activateSessionForFile(relPath)
  }, [])

  // ── Action dispatchers ─────────────────────────────────────────

  const doRename = useCallback(
    async (target: IndexedEntry) => {
      const next = await asyncPrompt('Rename to', target.name)
      if (!next || next === target.name) return
      if (next.includes('/') || next.includes('\\')) {
        window.alert('Name cannot contain path separators.')
        return
      }
      const nextRel = posixJoin(target.parentRel, next)
      await renameEntry(target.relPath, nextRel)

      // `.chat.json` files back a runtime-store session whose title appears
      // in AgentComposer's header. Renaming the file alone leaves the chat
      // panel showing the stale title, which is why users report "rename
      // doesn't work". Delegated to `syncChatTitleAfterRename` to keep the
      // envelope + runtime-store reconciliation out of the component body.
      if (nextRel.toLowerCase().endsWith('.chat.json')) {
        await syncChatTitleAfterRename(nextRel, next)
      }
    },
    [renameEntry],
  )

  const doDuplicate = useCallback(
    async (target: IndexedEntry) => {
      if (target.isDirectory) return
      const content = await readFile(target.relPath)
      if (content === null) {
        toast.error('Could not read file for duplication')
        return
      }
      const dotIdx = target.name.lastIndexOf('.')
      const stem = dotIdx > 0 ? target.name.slice(0, dotIdx) : target.name
      const ext = dotIdx > 0 ? target.name.slice(dotIdx) : ''
      let suffix = ' (copy)'
      let attempt = 0
      while (attempt < 20) {
        const newName = `${stem}${suffix}${ext}`
        const newRel = posixJoin(target.parentRel, newName)
        if (!fileIndex[newRel]) {
          await writeFile(newRel, content)
          toast.success(`Duplicated as ${newName}`)
          return
        }
        attempt += 1
        suffix = ` (copy ${attempt + 1})`
      }
      toast.error('Too many copies — rename one first')
    },
    [fileIndex, readFile, writeFile],
  )

  const doDelete = useCallback(
    async (target: IndexedEntry) => {
      const ok = window.confirm(`Move "${target.name}" to trash?`)
      if (!ok) return
      await deleteEntry(target.relPath, true)
    },
    [deleteEntry],
  )

  const doNewFile = useCallback(
    async (dir: string) => {
      const name = await asyncPrompt('New file name')
      if (!name) return
      await writeFile(posixJoin(dir, name), '')
    },
    [writeFile],
  )

  const doNewFolder = useCallback(
    async (dir: string) => {
      const name = await asyncPrompt('New folder name')
      if (!name) return
      await createFolder(posixJoin(dir, name))
    },
    [createFolder],
  )

  const doNewChat = useCallback(
    async (dir: string) => {
      const defaultName = `untitled-${Date.now()}`
      const rawName = await asyncPrompt('New chat name', defaultName)
      const name = rawName?.trim()
      if (!name) return
      if (name.includes('/') || name.includes('\\')) {
        window.alert('Chat name cannot contain path separators.')
        return
      }
      let targetDir = dir || 'chats'
      if (!fileIndex[targetDir]) await createFolder(targetDir)
      const filename = name.endsWith('.chat.json') ? name : `${name}.chat.json`
      const relPath = posixJoin(targetDir, filename)
      const id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      const now = Date.now()
      const fs = getWorkspaceFs()
      await writeEnvelope(fs, relPath, {
        kind: 'chat',
        id,
        createdAt: now,
        updatedAt: now,
        meta: {},
        payload: { messages: [], mentions: [], mode: 'dialog', model: null },
      })
      await refreshDir(targetDir)
      openFile(relPath)
    },
    [createFolder, fileIndex, openFile, refreshDir],
  )

  const doCopyPath = useCallback(async (target: IndexedEntry | null) => {
    const rel = target?.relPath ?? ''
    const api = window.electronAPI
    if (api?.workspaceCopyPath) {
      const res = await api.workspaceCopyPath(rel)
      if (res && typeof res === 'object' && 'ok' in res && res.ok) {
        toast.success('Path copied')
      } else {
        toast.error('Copy path failed')
      }
    } else {
      try {
        await navigator.clipboard.writeText(rel)
        toast.success('Relative path copied')
      } catch {
        toast.error('Clipboard not available')
      }
    }
  }, [])

  const doReveal = useCallback(async (target: IndexedEntry | null) => {
    const rel = target?.relPath ?? ''
    const api = window.electronAPI
    if (!api?.workspaceRevealInFolder) {
      toast.info('Reveal is only available in the desktop app')
      return
    }
    const res = await api.workspaceRevealInFolder(rel)
    if (!res?.ok) toast.error(res?.error ?? 'Reveal failed')
  }, [])

  const doOpenInSystem = useCallback(async (target: IndexedEntry) => {
    const api = window.electronAPI
    if (!api?.workspaceOpenInSystem) {
      toast.info('Open in system is only available in the desktop app')
      return
    }
    const res = await api.workspaceOpenInSystem(target.relPath)
    if (!res?.ok) toast.error(res?.error ?? 'Open in system failed')
  }, [])

  const doAssignSample = useCallback(async (target: IndexedEntry) => {
    const store = useDataIndexStore.getState()
    const existing = Object.values(store.index.samples)
    const names = existing.map((s) => s.name)
    const hint = names.length
      ? `Existing: ${names.join(', ')}\nEnter a name (existing or new):`
      : 'Enter a new sample name:'
    const input = await asyncPrompt(hint)
    if (!input) return
    const found = existing.find((s) => s.name === input)
    const sampleId = found ? found.id : store.createSample(input)
    store.assignFileToSample(target.relPath, sampleId)
    toast.success(`Assigned to sample "${input}"`)
  }, [])

  const doAddTags = useCallback(async (target: IndexedEntry) => {
    const input = await asyncPrompt('Tags (comma separated)')
    if (!input) return
    const store = useDataIndexStore.getState()
    const tags = input
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    for (const tag of tags) {
      store.tagFile(target.relPath, tag)
    }
    if (tags.length) toast.success(`Added ${tags.length} tag(s)`)
  }, [])

  // ── Add as @-mention (Phase 2) ─────────────────────────────────────
  // Reads the active session id imperatively via `.getState()` so this
  // callback doesn't re-subscribe on every session change — the click is
  // a one-shot dispatch, not a reactive derivation. If no session is
  // active the user has nothing to mention into, so we warn and bail
  // rather than quietly dropping the click.
  const handleAtClick = useCallback((target: IndexedEntry) => {
    if (target.isDirectory) return
    const activeSessionId = useRuntimeStore.getState().activeSessionId
    if (!activeSessionId) {
      toast.warn('Start a session first')
      return
    }
    dispatchMentionAdd({
      ref: {
        type: 'file',
        sessionId: activeSessionId,
        relPath: target.relPath,
      },
      label: target.name,
    })
    toast.info(`@${target.name} added to chat`)
    dispatchComposerFocus()
  }, [])

  // Branching (multi-select / file / folder / empty-area) lives in
  // `buildMenuItems`; this useMemo just threads the current target +
  // action bag through so ContextMenu re-renders only when they change.
  const menuItems = useMemo(
    () =>
      buildMenuItems({
        target: contextMenu?.target ?? null,
        selectedPaths: multiSelect.selected,
        isSelected: multiSelect.isSelected,
        clearSelection: multiSelect.clearSelection,
        hasElectron:
          typeof window !== 'undefined' && Boolean(window.electronAPI),
        deleteEntry,
        onOpen,
        doRename,
        doDuplicate,
        doDelete,
        doCopyPath,
        doReveal,
        doOpenInSystem,
        doAssignSample,
        doAddTags,
        doNewFile,
        doNewFolder,
        doNewChat,
        openProperties: setPropertiesTarget,
      }),
    [
      contextMenu,
      multiSelect,
      deleteEntry,
      onOpen,
      doRename,
      doDuplicate,
      doDelete,
      doNewFile,
      doNewFolder,
      doNewChat,
      doCopyPath,
      doReveal,
      doOpenInSystem,
      doAssignSample,
      doAddTags,
    ],
  )

  // ── Render ─────────────────────────────────────────────────────

  const renderNode = useCallback(
    (entry: IndexedEntry, depth: number): ReactElement => {
      const isOpen = expanded.has(entry.relPath)
      const children = entry.isDirectory
        ? byParent.get(entry.relPath) ?? []
        : []
      return (
        <FileTreeNode
          key={entry.relPath}
          entry={entry}
          depth={depth}
          expanded={isOpen}
          childEntries={children}
          isExpandedSet={expanded}
          onToggle={onToggle}
          onOpen={onOpen}
          onSelect={multiSelect.handleSelect}
          onContextMenu={(e, x, y) =>
            setContextMenu({ x, y, target: e })
          }
          renderChild={(c, d) => renderNode(c, d)}
          activeRel={activeGroupRel}
          selected={multiSelect.isSelected(entry.relPath)}
          onAtClick={handleAtClick}
          onChatEnter={enterChat}
        />
      )
    },
    [byParent, expanded, onToggle, onOpen, activeGroupRel, multiSelect, handleAtClick, enterChat],
  )

  return (
    <div
      ref={treeRef}
      tabIndex={0}
      style={{
        flex: 1,
        overflow: 'auto',
        paddingTop: 4,
        paddingBottom: 12,
        outline: 'none',
      }}
      onContextMenu={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault()
          setContextMenu({ x: e.clientX, y: e.clientY, target: null })
        }
      }}
    >
      {rootChildren.length === 0 ? (
        <div
          style={{
            padding: '8px 14px',
            fontSize: "var(--text-xs)",
            color: 'var(--color-text-muted)',
          }}
        >
          (empty workspace)
        </div>
      ) : (
        rootChildren.map((child) => renderNode(child, 0))
      )}
      <ContextMenu
        open={contextMenu !== null}
        x={contextMenu?.x ?? 0}
        y={contextMenu?.y ?? 0}
        items={menuItems}
        onClose={() => setContextMenu(null)}
      />
      {propertiesTarget && (
        <PropertiesDialog
          entry={propertiesTarget}
          onClose={() => setPropertiesTarget(null)}
        />
      )}
    </div>
  )
}

