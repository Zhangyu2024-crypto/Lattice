import type { IWorkspaceFs } from './IWorkspaceFs'
import type { FsEntry, FsStat, WatchEvent, LatticeFileKind } from './types'
import { fileKindFromName } from '../file-kind'

interface Node {
  isDir: boolean
  content: string
  mtime: number
}

function posixJoin(a: string, b: string): string {
  if (!a) return b
  if (!b) return a
  return `${a.replace(/\/+$/, '')}/${b.replace(/^\/+/, '')}`
}

function posixDirname(rel: string): string {
  const idx = rel.lastIndexOf('/')
  return idx < 0 ? '' : rel.slice(0, idx)
}

function posixBasename(rel: string): string {
  const idx = rel.lastIndexOf('/')
  return idx < 0 ? rel : rel.slice(idx + 1)
}

function normalizeRel(rel: string): string {
  const trimmed = rel.replace(/^\/+|\/+$/g, '')
  return trimmed
}

export class MemoryWorkspaceFs implements IWorkspaceFs {
  private _rootPath: string | null = null
  private nodes = new Map<string, Node>()
  private listeners = new Set<(event: WatchEvent) => void>()

  get rootPath(): string | null {
    return this._rootPath
  }

  async getRoot(): Promise<string | null> {
    return this._rootPath
  }

  async setRoot(absPath: string): Promise<string> {
    this._rootPath = absPath
    this.nodes.clear()
    return absPath
  }

  async listDir(rel: string): Promise<FsEntry[]> {
    const dir = normalizeRel(rel)
    const out: FsEntry[] = []
    const seen = new Set<string>()
    for (const [relPath, node] of this.nodes) {
      const parent = posixDirname(relPath)
      if (parent !== dir) continue
      const name = posixBasename(relPath)
      if (seen.has(name)) continue
      seen.add(name)
      const kind: LatticeFileKind | undefined = node.isDir
        ? undefined
        : fileKindFromName(name)
      out.push({
        name,
        relPath,
        parentRel: parent,
        isDirectory: node.isDir,
        size: node.isDir ? 0 : node.content.length,
        mtime: node.mtime,
        kind,
      })
    }
    return out.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }

  async stat(rel: string): Promise<FsStat> {
    const p = normalizeRel(rel)
    const node = this.nodes.get(p)
    if (!node) {
      return { relPath: p, isDirectory: false, size: 0, mtime: 0, exists: false }
    }
    return {
      relPath: p,
      isDirectory: node.isDir,
      size: node.isDir ? 0 : node.content.length,
      mtime: node.mtime,
      exists: true,
    }
  }

  async readText(rel: string): Promise<string> {
    const node = this.nodes.get(normalizeRel(rel))
    if (!node || node.isDir) throw new Error('not a file')
    return node.content
  }

  async readBinary(rel: string): Promise<ArrayBuffer> {
    const text = await this.readText(rel)
    return new TextEncoder().encode(text).buffer as ArrayBuffer
  }

  async readJson<T>(rel: string): Promise<T> {
    return JSON.parse(await this.readText(rel)) as T
  }

  async writeText(rel: string, data: string): Promise<void> {
    const p = normalizeRel(rel)
    const existed = this.nodes.has(p)
    this.ensureParents(p)
    this.nodes.set(p, { isDir: false, content: data, mtime: Date.now() })
    this.emit(existed ? { type: 'change', relPath: p } : { type: 'add', relPath: p, isDirectory: false })
  }

  async writeJson(rel: string, value: unknown): Promise<void> {
    await this.writeText(rel, JSON.stringify(value, null, 2))
  }

  async appendText(rel: string, data: string): Promise<void> {
    const p = normalizeRel(rel)
    const node = this.nodes.get(p)
    const next = (node?.content ?? '') + data
    await this.writeText(p, next)
  }

  async rename(from: string, to: string): Promise<void> {
    const src = normalizeRel(from)
    const dst = normalizeRel(to)
    const node = this.nodes.get(src)
    if (!node) throw new Error('source not found')
    this.nodes.delete(src)
    this.ensureParents(dst)
    this.nodes.set(dst, node)
    this.emit({ type: 'unlink', relPath: src, isDirectory: node.isDir })
    this.emit({ type: 'add', relPath: dst, isDirectory: node.isDir })
  }

  async delete(rel: string, _opts?: { toTrash?: boolean }): Promise<void> {
    const p = normalizeRel(rel)
    const node = this.nodes.get(p)
    if (!node) return
    this.nodes.delete(p)
    this.emit({ type: 'unlink', relPath: p, isDirectory: node.isDir })
  }

  async mkdir(rel: string): Promise<void> {
    const p = normalizeRel(rel)
    if (this.nodes.has(p)) return
    this.ensureParents(p)
    this.nodes.set(p, { isDir: true, content: '', mtime: Date.now() })
    this.emit({ type: 'add', relPath: p, isDirectory: true })
  }

  async exists(rel: string): Promise<boolean> {
    return this.nodes.has(normalizeRel(rel))
  }

  async watch(
    _rel: string,
    cb: (event: WatchEvent) => void,
  ): Promise<() => void> {
    this.listeners.add(cb)
    queueMicrotask(() => cb({ type: 'ready' }))
    return () => {
      this.listeners.delete(cb)
    }
  }

  private ensureParents(rel: string): void {
    let parent = posixDirname(rel)
    while (parent) {
      if (!this.nodes.has(parent)) {
        this.nodes.set(parent, { isDir: true, content: '', mtime: Date.now() })
      }
      parent = posixDirname(parent)
    }
  }

  private emit(event: WatchEvent): void {
    for (const l of this.listeners) {
      try {
        l(event)
      } catch {
        // Listener errors must not break siblings.
      }
    }
  }

  // Convenience test hook — avoids `_` unused-var lint.
  static childRel(parent: string, name: string): string {
    return posixJoin(parent, name)
  }
}
