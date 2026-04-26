// Electron ships as CommonJS. When this preload is built as ESM (required
// because package.json has "type": "module"), Node/Electron's ESM→CJS interop
// cannot statically analyse `electron`'s named exports, so
// `import { contextBridge } from 'electron'` throws at load time with
// "Named export 'contextBridge' not found". Use the default import and
// destructure at runtime instead.
import electron from 'electron'
const { contextBridge, ipcRenderer } = electron
import { COMPUTE_RUN_CHANNELS } from './compute-constants'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: unknown, payload: T) => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('electronAPI', {
  openFile: (options?: Record<string, unknown>) =>
    ipcRenderer.invoke('dialog:openFile', options),
  listSkills: () => ipcRenderer.invoke('slash:list-skills'),
  onSkillsChanged: (cb: () => void) => subscribe('slash:skills-changed', cb),
  listPlugins: () => ipcRenderer.invoke('slash:list-plugins'),
  pluginListTools: () => ipcRenderer.invoke('plugin:list-tools'),
  pluginCallTool: (payload: unknown) =>
    ipcRenderer.invoke('plugin:call-tool', payload),
  onPluginsChanged: (cb: () => void) =>
    subscribe('slash:plugins-changed', cb),
  mcpReconcile: (servers: unknown) =>
    ipcRenderer.invoke('mcp:reconcile', servers),
  mcpListPrompts: () => ipcRenderer.invoke('mcp:list-prompts'),
  mcpListTools: () => ipcRenderer.invoke('mcp:list-tools'),
  mcpCallTool: (payload: unknown) =>
    ipcRenderer.invoke('mcp:call-tool', payload),
  mcpGetPrompt: (payload: unknown) =>
    ipcRenderer.invoke('mcp:get-prompt', payload),
  onMcpPromptsChanged: (cb: () => void) =>
    subscribe('mcp:prompts-changed', cb),
  openDirectory: (options?: Record<string, unknown>) =>
    ipcRenderer.invoke('dialog:openDirectory', options),
  getBackendInfo: () =>
    ipcRenderer.invoke('backend:getInfo'),
  startBackend: () =>
    ipcRenderer.invoke('backend:start'),
  xrdDaraStatus: () => ipcRenderer.invoke('xrd:dara-status'),
  fileSaveDialog: (payload: {
    defaultFileName: string
    content: string
    filters?: Array<{ name: string; extensions: string[] }>
  }) => ipcRenderer.invoke('file:save-dialog', payload),
  onBackendStatus: (callback: (status: unknown) => void) =>
    subscribe('backend:status', callback),
  llmInvoke: (request: unknown) =>
    ipcRenderer.invoke('llm:invoke', request),
  llmTestConnection: (request: unknown) =>
    ipcRenderer.invoke('llm:test-connection', request),
  llmListModels: (request: unknown) =>
    ipcRenderer.invoke('llm:list-models', request),
  llmStreamStart: (request: unknown) =>
    ipcRenderer.invoke('llm:stream-start', request),
  llmStreamAbort: (streamId: string) =>
    ipcRenderer.invoke('llm:stream-abort', streamId),
  onLlmStreamChunk: (cb: (payload: { streamId: string; textDelta: string }) => void) =>
    subscribe('llm:stream-chunk', cb),
  onLlmStreamToolUse: (cb: (payload: { streamId: string; toolUse: { id: string; name: string; input: Record<string, unknown> } }) => void) =>
    subscribe('llm:stream-tool-use', cb),
  onLlmStreamEnd: (cb: (payload: { streamId: string; result: unknown }) => void) =>
    subscribe('llm:stream-end', cb),
  literatureSearch: (request: unknown) =>
    ipcRenderer.invoke('literature:search', request),
  computeRun: (request: unknown) =>
    ipcRenderer.invoke('compute:run', request),
  computeCancel: (runId: string) =>
    ipcRenderer.invoke('compute:cancel', runId),
  computeTestConnection: (request: unknown) =>
    ipcRenderer.invoke('compute:test-connection', request),
  computeOpenWorkdir: (workdir: string) =>
    ipcRenderer.invoke('compute:open-workdir', workdir),
  computeScriptsSave: (request: unknown) =>
    ipcRenderer.invoke('compute-scripts:save', request),
  computeScriptsList: () => ipcRenderer.invoke('compute-scripts:list'),
  computeScriptsLoad: (name: string) =>
    ipcRenderer.invoke('compute-scripts:load', name),
  libraryListPapers: (query: unknown) =>
    ipcRenderer.invoke('library:list-papers', query),
  libraryGetPaper: (id: number) =>
    ipcRenderer.invoke('library:get-paper', id),
  libraryAddPaper: (input: unknown) =>
    ipcRenderer.invoke('library:add-paper', input),
  libraryDeletePaper: (id: number) =>
    ipcRenderer.invoke('library:delete-paper', id),
  libraryListTags: () => ipcRenderer.invoke('library:list-tags'),
  libraryAddTag: (paperId: number, tag: string) =>
    ipcRenderer.invoke('library:add-tag', paperId, tag),
  libraryRemoveTag: (paperId: number, tag: string) =>
    ipcRenderer.invoke('library:remove-tag', paperId, tag),
  libraryListCollections: () => ipcRenderer.invoke('library:list-collections'),
  libraryCreateCollection: (input: unknown) =>
    ipcRenderer.invoke('library:create-collection', input),
  libraryDeleteCollection: (name: string) =>
    ipcRenderer.invoke('library:delete-collection', name),
  libraryAddToCollection: (name: string, paperId: number) =>
    ipcRenderer.invoke('library:add-to-collection', name, paperId),
  libraryRemoveFromCollection: (name: string, paperId: number) =>
    ipcRenderer.invoke('library:remove-from-collection', name, paperId),
  libraryStats: () => ipcRenderer.invoke('library:stats'),
  libraryImportPdf: (input: unknown) =>
    ipcRenderer.invoke('library:import-pdf', input),
  libraryDownloadAndImportPdf: (input: unknown) =>
    ipcRenderer.invoke('library:download-and-import-pdf', input),
  libraryRefreshMetadata: () =>
    ipcRenderer.invoke('library:refresh-metadata'),
  libraryScanDirectory: (input: unknown) =>
    ipcRenderer.invoke('library:scan-directory', input),
  libraryReadPdfBytes: (input: unknown) =>
    ipcRenderer.invoke('library:read-pdf-bytes', input),
  workerStatus: () => ipcRenderer.invoke('worker:status'),
  workerStart: () => ipcRenderer.invoke('worker:start'),
  workerCall: (req: unknown) => ipcRenderer.invoke('worker:call', req),
  workerHealth: () => ipcRenderer.invoke('worker:health'),
  workerStop: () => ipcRenderer.invoke('worker:stop'),
  onWorkerStatus: (callback: (status: unknown) => void) =>
    subscribe('worker:status', callback),
  onWorkerEvent: (callback: (event: unknown) => void) =>
    subscribe('worker:event', callback),
  libraryListAnnotations: (paperId: number) =>
    ipcRenderer.invoke('library:list-annotations', paperId),
  libraryAddAnnotation: (paperId: number, body: unknown) =>
    ipcRenderer.invoke('library:add-annotation', paperId, body),
  libraryUpdateAnnotation: (annId: number, patch: unknown) =>
    ipcRenderer.invoke('library:update-annotation', annId, patch),
  libraryDeleteAnnotation: (annId: number) =>
    ipcRenderer.invoke('library:delete-annotation', annId),
  onComputeStdout: (callback: (msg: { runId: string; chunk: string }) => void) =>
    subscribe(COMPUTE_RUN_CHANNELS.STDOUT, callback),
  onComputeStderr: (callback: (msg: { runId: string; chunk: string }) => void) =>
    subscribe(COMPUTE_RUN_CHANNELS.STDERR, callback),
  onComputeExit: (callback: (msg: unknown) => void) =>
    subscribe(COMPUTE_RUN_CHANNELS.EXIT, callback),
  issueApprovalToken: (req: unknown) =>
    ipcRenderer.invoke('approval-token:issue', req),
  // ─── Workspace bash (shell command runner) ─────────────────────
  // Trust-gated at the tool layer (`workspace_bash` = hostExec). cwd is
  // supplied in the request payload — main-chat callers pass the user's
  // configured workspace root.
  workspaceBash: (req: unknown) =>
    ipcRenderer.invoke('workspace:bash', req),
  onWorkspaceBashChunk: (
    callback: (msg: {
      invocationId: string
      stream: 'stdout' | 'stderr'
      data: string
    }) => void,
  ) => subscribe('workspace:bash-chunk', callback),
  onWorkspaceBashDone: (
    callback: (msg: {
      invocationId: string
      status: 'ok' | 'error' | 'timeout'
      exitCode: number | null
    }) => void,
  ) => subscribe('workspace:bash-done', callback),
  openWorkbenchWindow: (payload: { sessionId: string; artifactId: string }) =>
    ipcRenderer.invoke('workbench-window:open', payload),
  closeWorkbenchWindow: () =>
    ipcRenderer.invoke('workbench-window:close'),
  openLibraryWindow: () =>
    ipcRenderer.invoke('library-window:open'),
  closeLibraryWindow: () =>
    ipcRenderer.invoke('library-window:close'),
  librarySendPaperToMain: (payload: unknown) =>
    ipcRenderer.send('library:send-paper-to-main', payload),
  onLibraryOpenPaper: (callback: (payload: unknown) => void) =>
    subscribe('library:open-paper', callback),
  // ─── Cloud sync (WebDAV / rclone) ───────────────────────────────
  syncSetup: (req: unknown) => ipcRenderer.invoke('sync:setup', req),
  syncTestConnection: (req?: unknown) =>
    ipcRenderer.invoke('sync:test-connection', req ?? {}),
  syncStatus: () => ipcRenderer.invoke('sync:status'),
  syncPush: (opts?: unknown) => ipcRenderer.invoke('sync:push', opts ?? {}),
  syncPull: (opts?: unknown) => ipcRenderer.invoke('sync:pull', opts ?? {}),
  syncGetConfig: () => ipcRenderer.invoke('sync:get-config'),
  syncSetAutoPush: (enabled: boolean) =>
    ipcRenderer.invoke('sync:set-auto-push', { enabled }),
  syncSetAutoPull: (enabled: boolean) =>
    ipcRenderer.invoke('sync:set-auto-pull', { enabled }),
  syncSetInterval: (minutes: number) =>
    ipcRenderer.invoke('sync:set-interval', { minutes }),
  syncSetExcludedRoots: (roots: string[]) =>
    ipcRenderer.invoke('sync:set-excluded-roots', { roots }),
  syncFolderStats: () =>
    ipcRenderer.invoke('sync:folder-stats'),
  syncSetRemoteRoot: (folder: string) =>
    ipcRenderer.invoke('sync:set-remote-root', { folder }),
  syncDisableAuto: () =>
    ipcRenderer.invoke('sync:disable-auto'),
  // ─── Research report persistence (mirrors localStorage to disk) ─
  researchPersist: (payload: unknown) =>
    ipcRenderer.invoke('research:persist', payload),
  researchDelete: (payload: unknown) =>
    ipcRenderer.invoke('research:delete', payload),
  researchList: () => ipcRenderer.invoke('research:list'),
  researchExportPdf: (payload: unknown) =>
    ipcRenderer.invoke('research:export-pdf', payload),
  // ─── User-facing research workspace root (Phase 1) ─────────────
  workspaceRootGet: () => ipcRenderer.invoke('workspace-root:get'),
  workspaceRootSet: (rootPath: string) =>
    ipcRenderer.invoke('workspace-root:set', { rootPath }),
  workspaceList: (rel: string) =>
    ipcRenderer.invoke('workspace:list', { rel }),
  /** Compute overlay-scoped listing (independent of the global root). */
  computeListDirAt: (absPath: string) =>
    ipcRenderer.invoke('compute:list-dir-at', { absPath }),
  computeReadFileAt: (rootPath: string, relPath: string) =>
    ipcRenderer.invoke('compute:read-file-at', { rootPath, relPath }),
  computeRevealAt: (absPath: string) =>
    ipcRenderer.invoke('compute:reveal-at', { absPath }),
  computeCopyPathAt: (absPath: string) =>
    ipcRenderer.invoke('compute:copy-path-at', { absPath }),
  workspaceStat: (rel: string) =>
    ipcRenderer.invoke('workspace:stat', { rel }),
  workspaceRead: (rel: string) =>
    ipcRenderer.invoke('workspace:read', { rel }),
  workspaceReadBinary: (rel: string) =>
    ipcRenderer.invoke('workspace:readBinary', { rel }),
  workspaceWrite: (rel: string, content: string) =>
    ipcRenderer.invoke('workspace:write', { rel, content }),
  workspaceWriteBinary: (rel: string, data: ArrayBuffer) =>
    ipcRenderer.invoke('workspace:writeBinary', { rel, data }),
  workspaceAppend: (rel: string, content: string) =>
    ipcRenderer.invoke('workspace:append', { rel, content }),
  workspaceMove: (from: string, to: string) =>
    ipcRenderer.invoke('workspace:move', { from, to }),
  workspaceDelete: (rel: string, toTrash?: boolean) =>
    ipcRenderer.invoke('workspace:delete', {
      rel,
      toTrash: toTrash ?? true,
    }),
  workspaceMkdir: (rel: string) =>
    ipcRenderer.invoke('workspace:mkdir', { rel }),
  workspaceRevealInFolder: (rel: string) =>
    ipcRenderer.invoke('workspace:reveal-in-folder', rel),
  workspaceOpenInSystem: (rel: string) =>
    ipcRenderer.invoke('workspace:open-in-system', rel),
  workspaceCopyPath: (rel: string) =>
    ipcRenderer.invoke('workspace:copy-path', rel),
  workspaceWatchStart: (rel: string) =>
    ipcRenderer.invoke('workspace:watch:start', { rel }),
  workspaceWatchStop: (watchId: string) =>
    ipcRenderer.invoke('workspace:watch:stop', { watchId }),
  onWorkspaceWatchEvent: (
    callback: (payload: { watchId: string; event: unknown }) => void,
  ) => subscribe('workspace:watch:event', callback),
  openPdfReaderWindow: (relPath: string) =>
    ipcRenderer.invoke('pdf-reader:open', { relPath }),
  openDataManagerWindow: () =>
    ipcRenderer.invoke('data-manager:open'),
  platform: process.platform,
})
