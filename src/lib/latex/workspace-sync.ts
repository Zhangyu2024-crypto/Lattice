import type { LatexFile } from '../../types/latex'
import {
  creatorWorkspacePath,
  normalizeLatexProjectFiles,
} from './project-paths'
import type { IWorkspaceFs } from '../workspace/fs'

export type LatexWorkspaceSyncStatus =
  | 'idle'
  | 'syncing'
  | 'synced'
  | 'no-workspace'
  | 'error'

export interface LatexWorkspaceSyncState {
  status: LatexWorkspaceSyncStatus
  savedAt: number | null
  error: string | null
}

export const INITIAL_LATEX_WORKSPACE_SYNC: LatexWorkspaceSyncState = {
  status: 'idle',
  savedAt: null,
  error: null,
}

export async function syncLatexFilesToWorkspace(
  fs: IWorkspaceFs,
  files: LatexFile[],
): Promise<number> {
  const normalized = normalizeLatexProjectFiles(files)
  for (const file of normalized) {
    const rel = creatorWorkspacePath(file.path)
    if (!rel) continue
    await fs.writeText(rel, file.content)
  }
  return normalized.length
}
