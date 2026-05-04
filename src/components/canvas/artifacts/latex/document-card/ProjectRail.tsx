import {
  ChevronRight,
  FileCode2,
  FileText,
  Folder,
  Pencil,
  Plus,
  Star,
  Trash2,
} from 'lucide-react'
import { useMemo, useState, type CSSProperties } from 'react'
import type { LatexFile } from '../../../../../types/latex'

interface Props {
  files: LatexFile[]
  activeFile: string
  rootFile: string
  onSwitchFile: (path: string) => void
  onNewFile: () => void
  onCloseFile: (path: string) => void
  onRenameFile: (path: string) => void
  onSetRootFile: (path: string) => void
}

interface TreeNode {
  name: string
  path: string
  children: TreeNode[]
  file?: LatexFile
}

function fileIcon(file: LatexFile) {
  return file.kind === 'bib' ? <FileText size={13} /> : <FileCode2 size={13} />
}

function insert(root: TreeNode, file: LatexFile) {
  const parts = file.path.split('/')
  let node = root
  for (let i = 0; i < parts.length; i += 1) {
    const name = parts[i]
    const path = parts.slice(0, i + 1).join('/')
    let child = node.children.find((c) => c.name === name)
    if (!child) {
      child = { name, path, children: [] }
      node.children.push(child)
    }
    node = child
  }
  node.file = file
}

function sortTree(node: TreeNode): TreeNode {
  return {
    ...node,
    children: node.children
      .map(sortTree)
      .sort((a, b) => {
        if (Boolean(a.file) !== Boolean(b.file)) return a.file ? 1 : -1
        return a.name.localeCompare(b.name)
      }),
  }
}

function buildTree(files: LatexFile[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: [] }
  for (const file of files) insert(root, file)
  return sortTree(root)
}

function ProjectNode({
  node,
  depth,
  activeFile,
  rootFile,
  collapsedFolders,
  onToggleFolder,
  onSwitchFile,
  onCloseFile,
  onRenameFile,
  onSetRootFile,
}: {
  node: TreeNode
  depth: number
  activeFile: string
  rootFile: string
  collapsedFolders: Set<string>
  onToggleFolder: (path: string) => void
  onSwitchFile: (path: string) => void
  onCloseFile: (path: string) => void
  onRenameFile: (path: string) => void
  onSetRootFile: (path: string) => void
}) {
  if (!node.file) {
    const collapsed = collapsedFolders.has(node.path)
    return (
      <div className="latex-project-group">
        <button
          type="button"
          className="latex-project-folder"
          style={{ '--latex-project-depth': depth } as CSSProperties}
          onClick={() => onToggleFolder(node.path)}
          aria-expanded={!collapsed}
          title={collapsed ? `Expand ${node.path}` : `Collapse ${node.path}`}
        >
          <ChevronRight
            size={12}
            aria-hidden
            className={collapsed ? '' : 'is-open'}
          />
          <Folder size={13} aria-hidden />
          <span>{node.name}</span>
        </button>
        {collapsed ? null : node.children.map((child) => (
          <ProjectNode
            key={child.path}
            node={child}
            depth={depth + 1}
            activeFile={activeFile}
            rootFile={rootFile}
            collapsedFolders={collapsedFolders}
            onToggleFolder={onToggleFolder}
            onSwitchFile={onSwitchFile}
            onCloseFile={onCloseFile}
            onRenameFile={onRenameFile}
            onSetRootFile={onSetRootFile}
          />
        ))}
      </div>
    )
  }

  const isActive = node.file.path === activeFile
  const isRoot = node.file.path === rootFile
  return (
    <div
      className={
        'latex-project-file-row' +
        (isActive ? ' is-active' : '') +
        (isRoot ? ' is-root' : '')
      }
      style={{ '--latex-project-depth': depth } as CSSProperties}
    >
      <button
        type="button"
        className="latex-project-file"
        onClick={() => onSwitchFile(node.file!.path)}
        title={node.file.path}
      >
        {fileIcon(node.file)}
        <span className="latex-project-file-name">{node.name}</span>
        {isRoot ? <span className="latex-project-root-chip">root</span> : null}
      </button>
      {!isRoot ? (
        <button
          type="button"
          className="latex-project-action"
          aria-label={`Set ${node.file.path} as root file`}
          title="Set as root file"
          onClick={() => onSetRootFile(node.file!.path)}
        >
          <Star size={12} aria-hidden />
        </button>
      ) : null}
      <button
        type="button"
        className="latex-project-action"
        aria-label={`Rename ${node.file.path}`}
        title="Rename file"
        onClick={() => onRenameFile(node.file!.path)}
      >
        <Pencil size={12} aria-hidden />
      </button>
      <button
        type="button"
        className="latex-project-action latex-project-remove"
        aria-label={`Remove ${node.file.path}`}
        title="Remove file"
        onClick={() => onCloseFile(node.file!.path)}
      >
        <Trash2 size={12} aria-hidden />
      </button>
    </div>
  )
}

export function ProjectRail({
  files,
  activeFile,
  rootFile,
  onSwitchFile,
  onNewFile,
  onCloseFile,
  onRenameFile,
  onSetRootFile,
}: Props) {
  const tree = useMemo(() => buildTree(files), [files])
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
    () => new Set(),
  )
  const toggleFolder = (path: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }
  return (
    <aside className="latex-project-rail" aria-label="Creator project files">
      <div className="latex-project-rail-head">
        <span className="latex-project-title">Project</span>
        <button
          type="button"
          className="latex-project-new"
          onClick={onNewFile}
          title="Add file"
          aria-label="Add file"
        >
          <Plus size={14} aria-hidden />
        </button>
      </div>
      <div className="latex-project-tree">
        {tree.children.map((child) => (
          <ProjectNode
            key={child.path}
            node={child}
            depth={0}
            activeFile={activeFile}
            rootFile={rootFile}
            collapsedFolders={collapsedFolders}
            onToggleFolder={toggleFolder}
            onSwitchFile={onSwitchFile}
            onCloseFile={onCloseFile}
            onRenameFile={onRenameFile}
            onSetRootFile={onSetRootFile}
          />
        ))}
      </div>
    </aside>
  )
}
