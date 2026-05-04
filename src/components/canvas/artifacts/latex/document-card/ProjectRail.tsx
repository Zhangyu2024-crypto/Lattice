import { ChevronRight, FileCode2, FileText, Folder, Plus, Trash2 } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { LatexFile } from '../../../../../types/latex'

interface Props {
  files: LatexFile[]
  activeFile: string
  rootFile: string
  onSwitchFile: (path: string) => void
  onNewFile: () => void
  onCloseFile: (path: string) => void
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
  onSwitchFile,
  onCloseFile,
}: {
  node: TreeNode
  depth: number
  activeFile: string
  rootFile: string
  onSwitchFile: (path: string) => void
  onCloseFile: (path: string) => void
}) {
  if (!node.file) {
    return (
      <div className="latex-project-group">
        <div
          className="latex-project-folder"
          style={{ '--latex-project-depth': depth } as CSSProperties}
        >
          <ChevronRight size={12} aria-hidden />
          <Folder size={13} aria-hidden />
          <span>{node.name}</span>
        </div>
        {node.children.map((child) => (
          <ProjectNode
            key={child.path}
            node={child}
            depth={depth + 1}
            activeFile={activeFile}
            rootFile={rootFile}
            onSwitchFile={onSwitchFile}
            onCloseFile={onCloseFile}
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
      <button
        type="button"
        className="latex-project-remove"
        aria-label={`Remove ${node.file.path}`}
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
}: Props) {
  const tree = buildTree(files)
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
            onSwitchFile={onSwitchFile}
            onCloseFile={onCloseFile}
          />
        ))}
      </div>
    </aside>
  )
}
