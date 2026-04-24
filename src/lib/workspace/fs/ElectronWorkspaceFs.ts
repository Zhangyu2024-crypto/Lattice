import type { IWorkspaceFs } from './IWorkspaceFs'
import type { FsEntry, FsStat, WatchEvent } from './types'

type IpcOk<T> = { ok: true } & T
type IpcErr = { ok: false; error: string }
type IpcResult<T> = IpcOk<T> | IpcErr

function api() {
  const electronAPI = (window as unknown as { electronAPI?: Record<string, unknown> })
    .electronAPI
  if (!electronAPI) {
    throw new Error('ElectronWorkspaceFs: window.electronAPI unavailable')
  }
  return electronAPI as unknown as {
    workspaceRootGet: () => Promise<IpcResult<{ rootPath: string | null }>>
    workspaceRootSet: (
      rootPath: string,
    ) => Promise<IpcResult<{ rootPath: string }>>
    workspaceList: (rel: string) => Promise<IpcResult<{ entries: FsEntry[] }>>
    workspaceStat: (rel: string) => Promise<IpcResult<{ stat: FsStat }>>
    workspaceRead: (rel: string) => Promise<IpcResult<{ content: string }>>
    workspaceReadBinary: (rel: string) => Promise<IpcResult<{ data: ArrayBuffer }>>
    workspaceWrite: (
      rel: string,
      content: string,
    ) => Promise<IpcResult<{ bytes: number }>>
    workspaceAppend: (
      rel: string,
      content: string,
    ) => Promise<IpcResult<Record<string, never>>>
    workspaceMove: (
      from: string,
      to: string,
    ) => Promise<IpcResult<Record<string, never>>>
    workspaceDelete: (
      rel: string,
      toTrash?: boolean,
    ) => Promise<IpcResult<Record<string, never>>>
    workspaceMkdir: (rel: string) => Promise<IpcResult<Record<string, never>>>
    workspaceWatchStart: (
      rel: string,
    ) => Promise<IpcResult<{ watchId: string }>>
    workspaceWatchStop: (
      watchId: string,
    ) => Promise<IpcResult<Record<string, never>>>
    onWorkspaceWatchEvent: (
      cb: (payload: { watchId: string; event: WatchEvent }) => void,
    ) => () => void
  }
}

function unwrap<T extends object>(result: IpcResult<T>): T {
  if (!result || typeof result !== 'object') {
    throw new Error('workspace ipc: malformed response')
  }
  if (result.ok === true) return result
  throw new Error(result.error || 'workspace ipc: unknown error')
}

export class ElectronWorkspaceFs implements IWorkspaceFs {
  private _rootPath: string | null = null

  get rootPath(): string | null {
    return this._rootPath
  }

  async getRoot(): Promise<string | null> {
    const res = unwrap(await api().workspaceRootGet())
    this._rootPath = res.rootPath
    return res.rootPath
  }

  async setRoot(absPath: string): Promise<string> {
    const res = unwrap(await api().workspaceRootSet(absPath))
    this._rootPath = res.rootPath
    return res.rootPath
  }

  async listDir(rel: string): Promise<FsEntry[]> {
    const res = unwrap(await api().workspaceList(rel))
    return res.entries
  }

  async stat(rel: string): Promise<FsStat> {
    const res = unwrap(await api().workspaceStat(rel))
    return res.stat
  }

  async readText(rel: string): Promise<string> {
    const res = unwrap(await api().workspaceRead(rel))
    return res.content
  }

  async readBinary(rel: string): Promise<ArrayBuffer> {
    const res = unwrap(await api().workspaceReadBinary(rel))
    const raw: unknown = res.data
    if (raw instanceof ArrayBuffer) return raw
    if (raw instanceof Uint8Array) return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
    if (ArrayBuffer.isView(raw)) {
      return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
    }
    if (typeof raw === 'object' && raw !== null && 'type' in raw && (raw as { type: string }).type === 'Buffer' && 'data' in raw) {
      const u8 = new Uint8Array((raw as { data: number[] }).data)
      return u8.buffer as ArrayBuffer
    }
    throw new Error('readBinary: unexpected data type from IPC')
  }

  async readJson<T>(rel: string): Promise<T> {
    const text = await this.readText(rel)
    return JSON.parse(text) as T
  }

  async writeText(rel: string, data: string): Promise<void> {
    unwrap(await api().workspaceWrite(rel, data))
  }

  async writeJson(rel: string, value: unknown): Promise<void> {
    await this.writeText(rel, JSON.stringify(value, null, 2))
  }

  async appendText(rel: string, data: string): Promise<void> {
    unwrap(await api().workspaceAppend(rel, data))
  }

  async rename(from: string, to: string): Promise<void> {
    unwrap(await api().workspaceMove(from, to))
  }

  async delete(rel: string, opts?: { toTrash?: boolean }): Promise<void> {
    unwrap(await api().workspaceDelete(rel, opts?.toTrash ?? true))
  }

  async mkdir(rel: string): Promise<void> {
    unwrap(await api().workspaceMkdir(rel))
  }

  async exists(rel: string): Promise<boolean> {
    const s = await this.stat(rel)
    return s.exists
  }

  async watch(
    rel: string,
    cb: (event: WatchEvent) => void,
  ): Promise<() => void> {
    const { watchId } = unwrap(await api().workspaceWatchStart(rel))
    const off = api().onWorkspaceWatchEvent((payload) => {
      if (payload.watchId === watchId) {
        cb(payload.event)
      }
    })
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      off()
      void api()
        .workspaceWatchStop(watchId)
        .catch(() => {
          // Watcher already torn down by main — nothing to do.
        })
    }
  }
}
