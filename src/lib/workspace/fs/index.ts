import type { IWorkspaceFs } from './IWorkspaceFs'
import { ElectronWorkspaceFs } from './ElectronWorkspaceFs'
import { MemoryWorkspaceFs } from './MemoryWorkspaceFs'

let instance: IWorkspaceFs | null = null

export function getWorkspaceFs(): IWorkspaceFs {
  if (instance) return instance
  const electronAPI = (
    window as unknown as { electronAPI?: { workspaceRootGet?: unknown } }
  ).electronAPI
  if (electronAPI && typeof electronAPI.workspaceRootGet === 'function') {
    instance = new ElectronWorkspaceFs()
  } else {
    instance = new MemoryWorkspaceFs()
  }
  return instance
}

export type { IWorkspaceFs } from './IWorkspaceFs'
export type {
  FsEntry,
  FsStat,
  WatchEvent,
  LatticeFileKind,
} from './types'
