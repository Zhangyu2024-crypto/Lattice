// Context-menu builder extracted from FileTree.tsx. Keeping this as a
// plain function (not a hook) means we don't need to re-plumb the store
// selectors through a custom hook boundary — the caller already owns the
// action callbacks via useCallback and passes them in by reference.
//
// Three visual modes, driven by `target` and the multi-select snapshot:
//   1. Multi-selection (2+ files selected, right-click on one of them):
//      bulk delete / tag / sample-assign / copy-paths.
//   2. Single file (target && !target.isDirectory): full file menu.
//   3. Folder (target && target.isDirectory): new-*, rename, etc.
//   4. Empty-area (target === null): workspace-level new-* only.
//
// The file and folder branches share a tail (Assign Sample, Add Tags,
// Properties) but deliberately keep separate lists so future divergence
// (e.g. folder-only "Export as zip") doesn't require refactoring.

import {
  Clipboard,
  Copy,
  Edit2,
  ExternalLink,
  FileText,
  FolderOpen,
  FolderPlus,
  Info,
  MessageSquare,
  Plus,
  Tag,
  TestTube,
  Trash2,
} from 'lucide-react'
import type { ContextMenuItem } from '../../common/ContextMenu'
import type { IndexedEntry } from '../../../stores/workspace-store'
import { useDataIndexStore } from '../../../stores/data-index-store'
import { toast } from '../../../stores/toast-store'
import { asyncPrompt } from '../../../lib/prompt-dialog'

export interface BuildMenuItemsParams {
  /** Right-click target. `null` = empty area (workspace root). */
  target: IndexedEntry | null
  /** Set of relPaths currently multi-selected. */
  selectedPaths: Set<string>
  isSelected: (relPath: string) => boolean
  clearSelection: () => void
  /** Whether we're running inside Electron — gates OS-level actions. */
  hasElectron: boolean
  /** Workspace store dispatcher — only used by the bulk-delete branch. */
  deleteEntry: (relPath: string, toTrash: boolean) => Promise<unknown> | void
  /** Single-target action callbacks. */
  onOpen: (target: IndexedEntry) => void
  doRename: (target: IndexedEntry) => void
  doDuplicate: (target: IndexedEntry) => void
  doDelete: (target: IndexedEntry) => void
  doCopyPath: (target: IndexedEntry | null) => void
  doReveal: (target: IndexedEntry | null) => void
  doOpenInSystem: (target: IndexedEntry) => void
  doAssignSample: (target: IndexedEntry) => void
  doAddTags: (target: IndexedEntry) => void
  doNewFile: (dir: string) => void
  doNewFolder: (dir: string) => void
  doNewChat: (dir: string) => void
  /** Opens the Properties dialog for the given entry. */
  openProperties: (target: IndexedEntry) => void
}

export function buildMenuItems(params: BuildMenuItemsParams): ContextMenuItem[] {
  const {
    target,
    selectedPaths,
    isSelected,
    clearSelection,
    hasElectron,
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
    openProperties,
  } = params

  const items: ContextMenuItem[] = []

  // ─── Multi-selection: bulk actions ────────────────────────────────
  if (selectedPaths.size > 1 && target && isSelected(target.relPath)) {
    const count = selectedPaths.size
    const files = [...selectedPaths]
    items.push({
      label: `${count} files selected`,
      disabled: true,
      onClick: () => {},
    })
    items.push({
      label: `Delete (${count})`,
      icon: <Trash2 size={13} />,
      onClick: () => {
        if (window.confirm(`Delete ${count} files?`)) {
          for (const f of files) void deleteEntry(f, true)
          clearSelection()
        }
      },
    })
    items.push({
      label: 'Add Tags\u2026',
      icon: <Tag size={13} />,
      onClick: async () => {
        const raw = await asyncPrompt('Tags (comma separated)')
        if (!raw) return
        const tags = raw.split(',').map((t) => t.trim()).filter(Boolean)
        const dis = useDataIndexStore.getState()
        for (const f of files) for (const t of tags) dis.tagFile(f, t)
      },
    })
    items.push({
      label: 'Assign to Sample\u2026',
      icon: <TestTube size={13} />,
      onClick: async () => {
        const name = await asyncPrompt('Sample name')
        if (!name) return
        const dis = useDataIndexStore.getState()
        const existing = Object.values(dis.index.samples).find((s) => s.name === name)
        const sid = existing?.id ?? dis.createSample(name)
        for (const f of files) dis.assignFileToSample(f, sid)
      },
    })
    items.push({
      label: 'Copy Paths',
      icon: <Clipboard size={13} />,
      onClick: () => {
        void navigator.clipboard.writeText(files.join('\n'))
        toast.success(`${count} paths copied`)
      },
    })
    return items
  }

  // ─── Single file ──────────────────────────────────────────────────
  if (target && !target.isDirectory) {
    items.push({
      label: 'Open',
      icon: <FileText size={13} />,
      onClick: () => onOpen(target),
    })
    items.push({
      label: 'Rename',
      icon: <Edit2 size={13} />,
      onClick: () => void doRename(target),
    })
    items.push({
      label: 'Duplicate',
      icon: <Copy size={13} />,
      onClick: () => void doDuplicate(target),
    })
    items.push({
      label: 'Delete',
      icon: <Trash2 size={13} />,
      onClick: () => void doDelete(target),
    })
    items.push({
      label: 'Copy Path',
      icon: <Clipboard size={13} />,
      onClick: () => void doCopyPath(target),
    })
    if (hasElectron) {
      items.push({
        label: 'Reveal in Folder',
        icon: <FolderOpen size={13} />,
        onClick: () => void doReveal(target),
      })
      items.push({
        label: 'Open in System',
        icon: <ExternalLink size={13} />,
        onClick: () => void doOpenInSystem(target),
      })
    }
    items.push({
      label: 'Assign to Sample\u2026',
      icon: <TestTube size={13} />,
      onClick: () => doAssignSample(target),
    })
    items.push({
      label: 'Add Tags\u2026',
      icon: <Tag size={13} />,
      onClick: () => doAddTags(target),
    })
    items.push({
      label: 'Properties',
      icon: <Info size={13} />,
      onClick: () => openProperties(target),
    })
    return items
  }

  // ─── Folder ───────────────────────────────────────────────────────
  if (target && target.isDirectory) {
    items.push({
      label: 'New File',
      icon: <Plus size={13} />,
      onClick: () => void doNewFile(target.relPath),
    })
    items.push({
      label: 'New Folder',
      icon: <FolderPlus size={13} />,
      onClick: () => void doNewFolder(target.relPath),
    })
    items.push({
      label: 'New Chat',
      icon: <MessageSquare size={13} />,
      onClick: () => void doNewChat(target.relPath),
    })
    items.push({
      label: 'Rename',
      icon: <Edit2 size={13} />,
      onClick: () => void doRename(target),
    })
    items.push({
      label: 'Delete',
      icon: <Trash2 size={13} />,
      onClick: () => void doDelete(target),
    })
    items.push({
      label: 'Copy Path',
      icon: <Clipboard size={13} />,
      onClick: () => void doCopyPath(target),
    })
    if (hasElectron) {
      items.push({
        label: 'Reveal in Folder',
        icon: <FolderOpen size={13} />,
        onClick: () => void doReveal(target),
      })
    }
    items.push({
      label: 'Assign to Sample\u2026',
      icon: <TestTube size={13} />,
      onClick: () => doAssignSample(target),
    })
    items.push({
      label: 'Add Tags\u2026',
      icon: <Tag size={13} />,
      onClick: () => doAddTags(target),
    })
    items.push({
      label: 'Properties',
      icon: <Info size={13} />,
      onClick: () => openProperties(target),
    })
    return items
  }

  // ─── Empty area (workspace root) ──────────────────────────────────
  items.push({
    label: 'New File',
    icon: <Plus size={13} />,
    onClick: () => void doNewFile(''),
  })
  items.push({
    label: 'New Folder',
    icon: <FolderPlus size={13} />,
    onClick: () => void doNewFolder(''),
  })
  items.push({
    label: 'New Chat',
    icon: <MessageSquare size={13} />,
    onClick: () => void doNewChat(''),
  })
  if (hasElectron) {
    items.push({
      label: 'Reveal in Folder',
      icon: <FolderOpen size={13} />,
      onClick: () => void doReveal(null),
    })
  }
  return items
}
