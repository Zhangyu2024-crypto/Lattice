// Shared types + constants for the workspace-files agent tools.
//
// Split out of ../workspace-files.ts; the sibling tool files (read-file,
// write-file, edit-file, glob, grep) and helpers.ts all consume from
// here so the IPC surface + proposal shapes live in one place.

export const NO_WORKSPACE_ROOT =
  'No workspace root configured. Set it in Settings → Workspace.'

export const IPC_UNAVAILABLE =
  'workspace tools require the Electron shell; run `npm run electron:dev`.'

/** Keeps the LLM prompt from blowing up on a rogue giant file. Matches
 *  the root IPC's own 8 MB cap at a tighter 2 MB to leave headroom for
 *  multiple concurrent reads in one turn. */
export const MAX_READ_BYTES = 2 * 1024 * 1024
export const MAX_GLOB_RESULTS = 500
export const MAX_GREP_RESULTS = 200

// ─── electronAPI cast helpers ──────────────────────────────────────
//
// `window.electronAPI` is declared in `src/types/electron.d.ts` but the
// user-root IPC surface (workspaceRead, workspaceWrite, workspaceList,
// workspaceStat) is attached to the preload object and consumed by
// `ElectronWorkspaceFs.ts` via a local cast. We mirror that pattern
// here to keep this tool's typing self-contained.

interface RootFsIpcOk {
  ok: true
}
export type RootFsIpcResult<T> =
  | (RootFsIpcOk & T)
  | { ok: false; error: string }

export interface RootFsEntry {
  name: string
  relPath: string
  parentRel: string
  isDirectory: boolean
  size: number
  mtime: number
}

export interface RootFsStat {
  relPath: string
  isDirectory: boolean
  size: number
  mtime: number
  exists: boolean
}

export interface RootFsApi {
  workspaceRead: (rel: string) => Promise<RootFsIpcResult<{ content: string }>>
  workspaceWrite: (
    rel: string,
    content: string,
  ) => Promise<RootFsIpcResult<{ bytes: number }>>
  workspaceList: (
    rel: string,
  ) => Promise<RootFsIpcResult<{ entries: RootFsEntry[] }>>
  workspaceStat: (rel: string) => Promise<RootFsIpcResult<{ stat: RootFsStat }>>
}

// ─── Proposal shapes surfaced through AgentCard ────────────────────

export interface WorkspaceWriteProposal {
  relPath: string
  proposedContent: string
  sizeBytes: number
  /** Current disk contents, or null when the file does not yet exist.
   *  The applier uses this purely for UX (diff preview in the card
   *  editor); apply-time correctness does not depend on it. */
  existingContent: string | null
}

export interface WorkspaceEditPatch {
  oldString: string
  newString: string
}

export interface WorkspaceEditPatchError {
  /** 0-based index into the input `patches` array. */
  index: number
  /** Human-readable failure reason. Kept short so the editor can red-flag
   *  specific rows without truncation. */
  reason: string
}

export interface WorkspaceEditProposal {
  relPath: string
  patches: WorkspaceEditPatch[]
  existingContent: string
  /** Best-effort preview after applying every patch in sequence. Patches
   *  that produced an error in `errors` are skipped in the preview — the
   *  user sees exactly what a successful apply would look like, with the
   *  broken ones called out separately. */
  preview: string
  errors?: WorkspaceEditPatchError[]
}
