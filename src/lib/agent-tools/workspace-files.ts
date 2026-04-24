// Workspace file primitives — main-chat agent tools.
//
// read / glob / grep are safe auto-run tools that surface their output
// inline (cardMode:'info'). write / edit are proposal-first: execute()
// returns a diff-shaped proposal and the applier registry
// (src/components/agent/tool-cards/applier-registry.ts) performs the
// disk write only after the user approves the AgentCard.
//
// All paths are relative to `useWorkspaceStore().rootPath` (the
// Settings → Workspace root). The root IPC caps text reads at 8 MB;
// grep / glob cap at MAX_GREP_RESULTS / MAX_GLOB_RESULTS so one rogue
// workspace doesn't blow the LLM's context window.
//
// The concrete implementation is split across ./workspace-files/*:
//   - types.ts       shared constants, RootFs* IPC surface, proposal shapes
//   - helpers.ts     Electron guard, glob → RegExp, workspace walk, utils
//   - read-file.ts   workspace_read_file
//   - write-file.ts  workspace_write_file (proposal-first)
//   - edit-file.ts   workspace_edit_file  (proposal-first, multi-patch)
//   - glob.ts        workspace_glob
//   - grep.ts        workspace_grep
// This file re-exports the public surface so consumers can keep
// importing from `.../workspace-files`.

export type {
  WorkspaceEditPatch,
  WorkspaceEditPatchError,
  WorkspaceEditProposal,
  WorkspaceWriteProposal,
} from './workspace-files/types'

export { workspaceReadFileTool } from './workspace-files/read-file'
export { workspaceWriteFileTool } from './workspace-files/write-file'
export { workspaceEditFileTool } from './workspace-files/edit-file'
export { workspaceGlobTool } from './workspace-files/glob'
export { workspaceGrepTool } from './workspace-files/grep'
