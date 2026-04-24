import type { FsEntry, FsStat, WatchEvent } from './types'

export interface IWorkspaceFs {
  readonly rootPath: string | null

  getRoot(): Promise<string | null>
  setRoot(absPath: string): Promise<string>

  listDir(rel: string): Promise<FsEntry[]>
  stat(rel: string): Promise<FsStat>
  readText(rel: string): Promise<string>
  readBinary(rel: string): Promise<ArrayBuffer>
  readJson<T>(rel: string): Promise<T>
  writeText(rel: string, data: string): Promise<void>
  writeJson(rel: string, value: unknown): Promise<void>
  appendText(rel: string, data: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  delete(rel: string, opts?: { toTrash?: boolean }): Promise<void>
  mkdir(rel: string): Promise<void>
  exists(rel: string): Promise<boolean>
  watch(rel: string, cb: (event: WatchEvent) => void): Promise<() => void>
}
