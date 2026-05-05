import type { ToolCallRequest, ToolInputSchema } from './agent-tool'

export {}

/**
 * One resolved @-mention block injected into the LLM prompt by the renderer.
 * The main-process proxy splices these into the system prompt before
 * dispatching the HTTP call. See `electron/llm-proxy.ts#buildSystemPrompt`
 * and docs/CHAT_PANEL_REDESIGN.md §6.4.
 */
/**
 * Multi-turn tool-use messages carry provider-neutral content blocks.
 * `electron/llm-proxy.ts` translates these to Anthropic's native
 * `tool_use` / `tool_result` shape, or OpenAI's `tool_calls` / `role:'tool'`
 * messages, without either shape leaking into the renderer.
 */
export interface LlmTextBlockPayload {
  type: 'text'
  text: string
}

export interface LlmToolUseBlockPayload {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface LlmToolResultBlockPayload {
  type: 'tool_result'
  tool_use_id: string
  /** Stringified tool output (JSON or plain text). */
  content: string
}

/** Vision / multimodal user blocks — translated in `electron/llm-proxy.ts`. */
export interface LlmImageBlockPayload {
  type: 'image'
  source: {
    type: 'base64'
    media_type: string
    data: string
  }
}

export type LlmMessageBlockPayload =
  | LlmTextBlockPayload
  | LlmImageBlockPayload
  | LlmToolUseBlockPayload
  | LlmToolResultBlockPayload

export interface LlmMessagePayload {
  role: 'user' | 'assistant'
  content: string | LlmMessageBlockPayload[]
}

export interface LlmToolPayload {
  name: string
  description: string
  input_schema: ToolInputSchema
}

export interface LlmContextBlockPayload {
  /** Opaque key used to label the block in the prompt header. Typically the
   *  mention anchor (e.g. `ah5`); the main process does not interpret it. */
  refKey: string
  /** Already-serialized, budget-trimmed block body. */
  body: string
  /** Renderer-side token estimate; the main process may log it but does not
   *  rely on it for correctness. */
  tokenEstimate: number
}

export interface LlmInvokeRequestPayload {
  provider: 'anthropic' | 'openai' | 'openai-compatible'
  apiKey: string
  baseUrl: string
  model: string
  systemPrompt?: string
  messages: LlmMessagePayload[]
  maxTokens: number
  temperature: number
  timeoutMs?: number
  /**
   * Composer mode the request was issued from. Optional to preserve
   * compatibility with pre-MP-2 IPC callers; the main process treats absence
   * as 'dialog' (safer default — no tool schemas are emitted in that mode).
   */
  mode?: 'dialog' | 'agent'
  /**
   * Structured mention context blocks. Optional — when absent or empty the
   * proxy uses {@link LlmInvokeRequestPayload.systemPrompt} verbatim.
   */
  contextBlocks?: LlmContextBlockPayload[]
  /**
   * Tool definitions exposed to the model this turn. Only sent in Agent
   * mode; the proxy translates these into the provider's native tool schema.
   */
  tools?: LlmToolPayload[]
  /** Renderer-supplied audit context. Main-process audit logging consumes
   *  this locally and never forwards it to provider APIs. */
  audit?: {
    source?: string
    sessionId?: string | null
    taskId?: string
    stepId?: string
    workspaceRoot?: string | null
    metadata?: Record<string, unknown>
  }
  /**
   * Extended thinking effort level. When 'medium' or 'high', the Anthropic
   * SDK client enables the `thinking` parameter so the model can use
   * chain-of-thought reasoning before responding. 'low' or absent means
   * no thinking is requested.
   */
  reasoningEffort?: 'low' | 'medium' | 'high'
  traceId?: string
  module?: 'agent' | 'creator' | 'latex' | 'workspace' | 'compute' | 'research' | 'library'
  operation?: string
  sessionId?: string | null
  artifactId?: string | null
  workspaceIdHash?: string | null
  consentVersion?: string | null
}

export type LlmInvokeResultPayload =
  | {
      success: true
      content: string
      usage: { inputTokens: number; outputTokens: number }
      durationMs: number
      /** Provider tool-use requests parsed into our neutral shape.
       *  Absent / empty means the model emitted plain text only. */
      toolCalls?: ToolCallRequest[]
      /** Assistant turn content as the proxy received it (including any
       *  `tool_use` blocks), for the orchestrator to splice back into the
       *  messages array on the next iteration. */
      messages?: LlmMessagePayload[]
      /** Concatenated thinking blocks from an extended-thinking response.
       *  Only present when `reasoningEffort` was 'medium' or 'high' and the
       *  model actually produced thinking content. */
      thinkingContent?: string
    }
  | {
      success: false
      error: string
      status?: number
      durationMs: number
    }

export interface LlmTestConnectionRequestPayload {
  provider: 'anthropic' | 'openai' | 'openai-compatible'
  apiKey: string
  baseUrl: string
  timeoutMs?: number
  traceId?: string
  module?: 'agent' | 'creator' | 'latex' | 'workspace' | 'compute' | 'research' | 'library'
  operation?: string
  sessionId?: string | null
  artifactId?: string | null
  workspaceIdHash?: string | null
  consentVersion?: string | null
}

export type LlmTestConnectionResultPayload =
  | {
      success: true
      durationMs: number
      modelCount?: number
    }
  | {
      success: false
      error: string
      status?: number
      durationMs: number
    }

/**
 * One model entry as reported by the provider's `GET /v1/models` endpoint.
 * Only `id` is guaranteed — `displayName` / `createdAt` are best-effort and
 * callers must treat their absence as "unknown" rather than falling back to
 * synthetic values.
 */
export interface LlmListedModelPayload {
  id: string
  displayName?: string
  createdAt?: number
}

export interface LlmListModelsRequestPayload {
  provider: 'anthropic' | 'openai' | 'openai-compatible'
  apiKey: string
  baseUrl: string
  timeoutMs?: number
  traceId?: string
  module?: 'agent' | 'creator' | 'latex' | 'workspace' | 'compute' | 'research' | 'library'
  operation?: string
  sessionId?: string | null
  artifactId?: string | null
  workspaceIdHash?: string | null
  consentVersion?: string | null
}

export type LlmListModelsResultPayload =
  | {
      success: true
      durationMs: number
      models: LlmListedModelPayload[]
    }
  | {
      success: false
      error: string
      status?: number
      durationMs: number
    }

export type LatticeAuthSessionPayload =
  | {
      authenticated: true
      baseUrl: string
      username: string
      keyId: string
      keyPrefix: string
      savedAt: string
    }
  | { authenticated: false }

export type LatticeAuthLoginResultPayload =
  | ({
      ok: true
    } & Extract<LatticeAuthSessionPayload, { authenticated: true }>)
  | { ok: false; error: string }

export type LatticeCollabTicketResultPayload =
  | {
      ok: true
      ticket: string
      expiresAt: string
      expiresIn: number
      roomName: string
      userId?: string
      username?: string
    }
  | { ok: false; error: string }

export type AppUpdateState =
  | 'idle'
  | 'checking'
  | 'latest'
  | 'available'
  | 'error'

export interface AppUpdateStatusPayload {
  state: AppUpdateState
  currentVersion: string
  latestVersion?: string
  releaseName?: string
  releaseUrl?: string
  downloadUrl?: string
  assetName?: string
  publishedAt?: string
  checkedAt?: string
  updateAvailable: boolean
  error?: string
}

export type AppUpdateOpenReleaseResult =
  | { ok: true; url: string }
  | { ok: false; error: string }

// ─── Literature search (OpenAlex + arXiv) ───────────────────────────
//
// Ported from lattice-cli's `_search_openalex` / `_search_arxiv`
// (`tools/survey_pipeline.py`). Called by the renderer's
// `literature_search` agent tool and by any UI surface that wants to
// offer direct paper discovery (none exist yet). The renderer only sees
// results — HTTPS to openalex.org / arxiv.org happens in the main
// process so the renderer CSP stays tight.

export interface PaperSearchResultPayload {
  id: string
  title: string
  abstract: string
  authors: string
  year: string
  doi: string
  url: string
  source: 'openalex' | 'arxiv' | 'semantic_scholar'
  venue: string
  citedByCount?: number
  /** Open-access PDF URL (OpenAlex `open_access.oa_url` or arXiv-derived). */
  oaPdfUrl?: string
}

export interface LiteratureSearchRequestPayload {
  query: string
  limit?: number
  timeoutMs?: number
  mailto?: string
}

export interface LiteratureSourceDiagnosticPayload {
  ok: boolean
  count: number
  error?: string
}

export interface LiteratureSearchDiagnosticsPayload {
  openalex: LiteratureSourceDiagnosticPayload
  arxiv: LiteratureSourceDiagnosticPayload
  semanticScholar: LiteratureSourceDiagnosticPayload
}

export type LiteratureSearchResultPayload =
  | {
      success: true
      query: string
      durationMs: number
      totalFetched: number
      results: PaperSearchResultPayload[]
      diagnostics: LiteratureSearchDiagnosticsPayload
    }
  | {
      success: false
      error: string
      durationMs: number
    }

export type ComputeModePayload = 'native' | 'disabled'

export type ComputeLanguagePayload = 'python' | 'lammps' | 'cp2k' | 'shell'

/** Session context injected as env vars inside the container. Mirrors
 *  lattice-cli's ACTIVE_CIFS / CURRENT_SPECTRUM / WORKDIR globals so user
 *  snippets can access the session without an explicit pass-through. */
export interface ComputeRunContextPayload {
  activeCifs?: Record<string, unknown> | null
  currentSpectrum?: Record<string, unknown> | null
  workdir?: string | null
}

export interface ComputeRunRequestPayload {
  runId: string
  code: string
  language?: ComputeLanguagePayload
  mode: ComputeModePayload
  timeoutSec: number
  context?: ComputeRunContextPayload
  resources?: {
    cpuCores?: number
    ompThreads?: number | 'auto'
  }
  /** Optional session + artifact identifiers. When both are supplied,
   *  the runner archives this run under
   *  `<userData>/workspace/compute/<sid>/<aid>/run_.../` and includes
   *  the absolute `workdir` path in the exit event. */
  sessionId?: string
  artifactId?: string
  approvalToken?: string
}

export type ComputeRunAckPayload =
  | { success: true; runId: string; workdir?: string }
  | { success: false; error: string }

export interface ComputeTestRequestPayload {
  mode: ComputeModePayload
}

/** Probe result for the Native compute environment. `container_up` is kept
 *  as a legacy field name meaning "conda env probe succeeded". */
export interface ComputeTestResultPayload {
  container_up: boolean
  python_version?: string | null
  packages?: Record<string, string>
  lammps_available?: boolean
  cp2k_available?: boolean
  error?: string | null
}

export interface ComputeStreamChunkPayload {
  runId: string
  chunk: string
}

export interface ComputeFigurePayloadShape {
  format: 'png' | 'svg'
  base64: string
  caption?: string
}

export interface ComputeExitEventPayload {
  runId: string
  exitCode: number | null
  figures: ComputeFigurePayloadShape[]
  durationMs: number
  cancelled: boolean
  timedOut?: boolean
  error?: string
  /** Absolute path to this run's archived workdir. Absent when the run
   *  was programmatic (no sessionId/artifactId) or archival failed. */
  workdir?: string
}

// ─── Compute scripts (P1: ComputeProWorkbench self-contained migration) ───
//
// User-saved compute scripts stored on disk under
// `app.getPath('userData')/compute-scripts/`. Replaces the lattice-cli
// `/api/pro/compute/save-script | scripts | script/{name}` REST surface
// so the workbench can run without any external backend.

export interface ComputeScriptsSaveRequestPayload {
  name: string
  code: string
}

export type ComputeScriptsSaveResultPayload =
  | { success: true; name: string; path: string; modified: number }
  | { success: false; error: string }

export interface ComputeScriptListEntryPayload {
  name: string
  filename: string
  size: number
  modified: number
}

export interface ComputeScriptsListResultPayload {
  scripts: ComputeScriptListEntryPayload[]
}

export type ComputeScriptsLoadResultPayload =
  | {
      success: true
      name: string
      filename: string
      code: string
      modified: number
    }
  | { success: false; error: string }

// ─── Local library (self-contained path) ─────────────────────────────
//
// Mirrors a narrow subset of `/api/library/*` so the renderer can store +
// read papers under userData without a backend. Types stay as `unknown`
// for request/response payloads on the IPC line — the facade in
// `src/lib/local-pro-library.ts` is responsible for the tight contract
// with the rest of the app (matching `src/types/library-api.ts`).

export interface LibraryListPapersQueryPayload {
  q?: string
  tag?: string
  year?: string
  collection?: string
  page?: number
  limit?: number
  sort?: string
  order?: 'asc' | 'desc'
}

/** Library window → main window: open a paper in the workspace session. */
export interface LibraryOpenPaperIpcPayload {
  paperId: string
  metadata: {
    title: string
    authors: string[]
    year: number
    venue: string
    doi?: string
  }
  abstract: string
}

export interface LibraryPaperRowPayload {
  id: number
  title: string
  title_norm?: string
  authors: string
  year: string
  doi?: string
  url?: string
  journal?: string
  abstract?: string
  source?: string
  citation_count?: number
  bib_key?: string
  notes?: string
  pdf_path?: string
  created_at?: string
  updated_at?: string
  tags?: string[]
  collections?: string[]
}

export interface LibraryListPapersResultPayload {
  papers: LibraryPaperRowPayload[]
  total: number
  error?: string
}

export interface LibraryAddPaperInputPayload {
  title: string
  authors: string
  year?: string
  doi?: string
  url?: string
  journal?: string
  abstract?: string
  notes?: string
  tags?: string[]
  collection?: string
}

export type LibraryAddPaperResultPayload =
  | { success: true; id: number }
  | { success: false; error: string }

export type LibraryDeletePaperResultPayload =
  | { success: true }
  | { success: false; error: string }

export interface LibraryTagEntryPayload {
  name: string
  count: number
}

export type LibraryAddTagResultPayload =
  | { success: true }
  | { success: false; error: string }

export type LibraryRemoveTagResultPayload = LibraryAddTagResultPayload

export interface LibraryCollectionEntryPayload {
  name: string
  description: string
  count: number
}

export interface LibraryCreateCollectionInputPayload {
  name: string
  description?: string
}

export type LibraryCreateCollectionResultPayload =
  | { success: true; id: number }
  | { success: false; error: string }

export type LibrarySimpleResultPayload = { success: boolean; error?: string }

export interface LibraryStatsPayload {
  total_papers: number
  total_tags: number
  tag_count: number
  collection_count: number
  by_source: Record<string, number>
  by_year: Record<string, number>
}

export interface LibraryImportPdfRequestPayload {
  /** Absolute path to a PDF on disk. Main process copies it into the
   *  app-owned storage dir; renderer never gets raw write access. */
  sourcePath: string
  collection?: string
  tags?: string[]
}

export type LibraryImportPdfResultPayload =
  | {
      success: true
      id: number
      pdfPath: string
      /** True when the title collided with an existing paper and the PDF
       *  was attached to it instead of creating a new row. */
      deduped: boolean
    }
  | { success: false; error: string }

export interface LibraryDownloadAndImportPdfRequestPayload {
  pdfUrl: string
  title: string
  authors: string
  year?: string
  doi?: string
  url?: string
  journal?: string
  abstract?: string
  tags?: string[]
  collection?: string
}

export type LibraryDownloadAndImportPdfResultPayload =
  | { success: true; id: number; pdfPath: string; deduped: boolean }
  | { success: false; error: string }

export interface LibraryScanDirectoryRequestPayload {
  directory: string
  collection?: string
  tags?: string[]
}

export type LibraryScanDirectoryResultPayload =
  | {
      success: true
      /** Count of .pdf files found during the walk. 0 means the directory
       *  was reachable but contained no PDFs (distinct from a failed scan,
       *  which sets `success: false`). */
      scanned: number
      added: number
      errors?: string[]
    }
  | { success: false; error: string }

export type LibraryRefreshMetadataResultPayload =
  | {
      success: true
      /** Rows flagged as needing refresh (Unknown author, missing / spaced DOI, …). */
      scanned: number
      /** Rows whose Crossref lookup succeeded and whose metadata was overwritten. */
      refreshed: number
      /** Rows that had no resolvable DOI candidate, or Crossref returned no record. */
      skipped: number
      errors?: { id: number; title: string; msg: string }[]
    }
  | { success: false; error: string }

export interface LibraryReadPdfBytesRequestPayload {
  id: number
}

export type LibraryReadPdfBytesResultPayload =
  | {
      ok: true
      /** Raw PDF bytes, moved across the bridge via structured clone.
       *  Callers wrap in `new Blob([bytes], {type: 'application/pdf'})`
       *  and hand the blob URL to pdfjs. */
      bytes: ArrayBuffer
      size: number
    }
  | { ok: false; error: string }

export interface LibraryAnnotationPayload {
  id: number
  paper_id: number
  page: number
  type: string
  color: string
  content: string
  rects: Array<{ x: number; y: number; width: number; height: number }>
  created_at?: string
  updated_at?: string
}

export interface LibraryListAnnotationsResultPayload {
  success: boolean
  annotations: LibraryAnnotationPayload[]
  error?: string
}

export type LibraryAddAnnotationResultPayload =
  | { success: true; id: number; annotation: LibraryAnnotationPayload }
  | { success: false; error: string }

export type LibraryUpdateAnnotationResultPayload =
  | { success: true; annotation: LibraryAnnotationPayload }
  | { success: false; error: string }

export type LibraryDeleteAnnotationResultPayload =
  | { success: true }
  | { success: false; error: string }

// ─── Python worker (P4-α) ─────────────────────────────────────────────

export type WorkerStatusPayload =
  | { state: 'idle' }
  | { state: 'starting' }
  | {
      state: 'ready'
      tools: string[]
      pythonVersion: string
      protocol: string
    }
  | { state: 'failed'; error: string }

export interface WorkerCallRequestPayload {
  method: string
  params?: Record<string, unknown>
  timeoutMs?: number
}

export type WorkerCallResultPayload =
  | { success: true; result: unknown; durationMs: number }
  | { success: false; error: string; durationMs: number; code?: string }

export type WorkerStartResultPayload =
  | { success: true; status: WorkerStatusPayload }
  | { success: false; error: string; status: WorkerStatusPayload }

// ─── LLM streaming events ─────────────────────────────────────────────

export interface LlmStreamChunkEvent {
  streamId: string
  textDelta: string
}

export interface LlmStreamToolUseEvent {
  streamId: string
  toolUse: {
    id: string
    name: string
    input: Record<string, unknown>
  }
}

export interface LlmStreamEndEvent {
  streamId: string
  result: LlmInvokeResultPayload
}

export type LlmStreamStartResult =
  | { ok: true; streamId: string }
  | { ok: false; error: string }

export type ResearchExportPdfPageSize = 'A4' | 'Letter'

export interface ResearchExportPdfRequest {
  defaultFileName: string
  pageSize?: ResearchExportPdfPageSize
}

export type ResearchExportPdfResult =
  | {
      ok: true
      filePath: string
      pageSize: ResearchExportPdfPageSize
    }
  | { ok: false; canceled: true }
  | { ok: false; error: string }

export interface AuditStatusPayload {
  enabled: boolean
  acceptedAgreementVersion: string | null
  currentAgreementVersion: string
  retentionDays: number
  logDir: string
}

export interface AuditConfigurePayload {
  enabled: boolean
  acceptedAgreementVersion: string | null
  currentAgreementVersion: string
  retentionDays: number
}

export type AuditSimpleResult =
  | { ok: true; logDir?: string }
  | { ok: false; error: string }

export type AuditExportResult =
  | { ok: true; path: string; fileCount: number }
  | { ok: false; error: string }

/** A streamed event from the worker tagged with the originating request
 *  id (when the worker emits it under one). Renderer subscribers should
 *  filter by `event` + `id` to react only to relevant traffic. */
export interface WorkerEventPayload {
  event: string
  id?: string
  [key: string]: unknown
}

export interface ApiCallAuditPayload {
  kind: string
  source?: string
  operation?: string
  status?: 'accepted' | 'ok' | 'error' | 'cancelled' | 'dropped'
  durationMs?: number
  sessionId?: string | null
  taskId?: string
  stepId?: string
  workspaceRoot?: string | null
  request?: unknown
  response?: unknown
  error?: unknown
  meta?: Record<string, unknown>
}

declare global {
  interface Window {
    electronAPI?: {
      openFile: (options?: Record<string, unknown>) => Promise<string | null>
      openDirectory: (options?: Record<string, unknown>) => Promise<string | null>
      /**
       * Enumerate user skill files under `<userData>/skills/`. Returns
       * `{skills, errors}`: parsed file contents plus any per-file read
       * errors. Consumed by the slash-command registry's skill loader.
       */
      listSkills: () => Promise<{
        skills: Array<{ fileName: string; source: string }>
        errors: Array<{ fileName: string; message: string }>
      }>
      /**
       * Fires when the main process sees a change in `<userData>/skills/`.
       * Renderer should re-warm the skill cache. Returns an unsubscribe
       * function (same convention as other `on*` channels in this bridge).
       */
      onSkillsChanged: (callback: () => void) => () => void
      /**
       * Enumerate plugin folders under `<userData>/plugins/`. Each plugin
       * is a directory with an optional `plugin.json` manifest and an
       * optional `skills/` subdirectory of markdown command files.
       */
      listPlugins: () => Promise<{
        plugins: Array<{
          name: string
          manifest: {
            name?: string
            description?: string
            version?: string
          }
          skills: Array<{ fileName: string; source: string }>
          tools: Array<{
            name: string
            description?: string
            inputSchema?: unknown
          }>
          error?: string
        }>
        error?: string
      }>
      /** List executable tools declared in enabled/installed plugin manifests. */
      pluginListTools: () => Promise<{
        tools: Array<{
          plugin: string
          name: string
          description?: string
          inputSchema?: unknown
        }>
        errors: Array<{ plugin: string; message: string }>
      }>
      /** Execute a plugin tool declared in plugin.json. */
      pluginCallTool: (payload: {
        plugin: string
        name: string
        input?: Record<string, unknown>
        approvalToken: string
      }) => Promise<{ output: unknown; stdout: string; stderr: string }>
      /** Fires on any change under `<userData>/plugins/`. */
      onPluginsChanged: (callback: () => void) => () => void
      /**
       * Push the full desired list of MCP servers to the main process.
       * Main reconciles: spawns new stdio clients, shuts down removed or
       * disabled ones. Returns the ids of currently-running servers plus
       * any per-server startup errors.
       */
      mcpReconcile: (
        servers: Array<{
          id: string
          name: string
          command: string
          args: string[]
          env?: Record<string, string>
        }>,
      ) => Promise<{
        running: string[]
        errors: Array<{ serverId: string; name: string; message: string }>
      }>
      /** Cached `prompts/list` output from every running MCP client. */
      mcpListPrompts: () => Promise<{
        prompts: Array<{
          serverId: string
          serverName: string
          name: string
          description?: string
          arguments?: Array<{
            name: string
            description?: string
            required?: boolean
          }>
        }>
        errors: Array<{ serverId: string; name: string; message: string }>
      }>
      /** Cached `tools/list` output from every running MCP client. */
      mcpListTools: () => Promise<{
        tools: Array<{
          serverId: string
          serverName: string
          name: string
          description?: string
          inputSchema?: unknown
        }>
        errors: Array<{ serverId: string; name: string; message: string }>
      }>
      /** Invoke `tools/call` on a running server. */
      mcpCallTool: (payload: {
        serverId: string
        name: string
        args?: Record<string, unknown>
        approvalToken: string
      }) => Promise<{ result: unknown }>
      /** Invoke `prompts/get` on a running server; returns flattened text. */
      mcpGetPrompt: (payload: {
        serverId: string
        name: string
        args?: Record<string, string>
      }) => Promise<{ text: string }>
      /** Fires when MCP clients start / stop / refresh. */
      onMcpPromptsChanged: (callback: () => void) => () => void
      getBackendInfo: () => Promise<{
        ready: boolean
        port: number
        token: string
        baseUrl: string
      }>
      startBackend: () => Promise<{ success: boolean; error?: string }>
      /** Reports whether BGMN Rietveld (dara-xrd) is available. Always
       *  true since dara-xrd is now a bundled dependency. */
      xrdDaraStatus: () => Promise<{ configured: boolean }>
      fileSaveDialog: (payload: {
        defaultFileName: string
        content: string
        filters?: Array<{ name: string; extensions: string[] }>
      }) => Promise<{ ok: boolean; canceled?: boolean; filePath?: string }>
      onBackendStatus: (callback: (status: {
        ready: boolean
        port?: number
        token?: string
        error?: string
      }) => void) => () => void
      llmInvoke: (
        request: LlmInvokeRequestPayload,
      ) => Promise<LlmInvokeResultPayload>
      llmTestConnection: (
        request: LlmTestConnectionRequestPayload,
      ) => Promise<LlmTestConnectionResultPayload>
      llmListModels: (
        request: LlmListModelsRequestPayload,
      ) => Promise<LlmListModelsResultPayload>
      // ─── LLM streaming ───────────────────────────────────────────
      llmStreamStart: (
        request: LlmInvokeRequestPayload,
      ) => Promise<LlmStreamStartResult>
      llmStreamAbort: (streamId: string) => Promise<void>
      latticeAuthGetSession: () => Promise<LatticeAuthSessionPayload>
      latticeAuthLogin: (payload?: {
        authBaseUrl?: string
      }) => Promise<LatticeAuthLoginResultPayload>
      latticeAuthLogout: () => Promise<{ ok: true }>
      latticeAuthCollabTicket: (payload: {
        serverUrl?: string
        projectId: string
        roomId: string
        roomName: string
        roomAccessKey: string
        role?: string
      }) => Promise<LatticeCollabTicketResultPayload>
      onLlmStreamChunk: (
        callback: (event: LlmStreamChunkEvent) => void,
      ) => () => void
      onLlmStreamToolUse: (
        callback: (event: LlmStreamToolUseEvent) => void,
      ) => () => void
      onLlmStreamEnd: (
        callback: (event: LlmStreamEndEvent) => void,
      ) => () => void
      literatureSearch: (
        request: LiteratureSearchRequestPayload,
      ) => Promise<LiteratureSearchResultPayload>
      computeRun: (
        request: ComputeRunRequestPayload,
      ) => Promise<ComputeRunAckPayload>
      computeCancel: (runId: string) => Promise<{ success: boolean }>
      computeTestConnection: (
        request: ComputeTestRequestPayload,
      ) => Promise<ComputeTestResultPayload>
      /** Open an archived compute run's workdir in the host file
       *  manager (Finder / Explorer / xdg-open). Rejects paths outside
       *  `<userData>/workspace/compute/`. */
      computeOpenWorkdir: (
        workdir: string,
      ) => Promise<{ success: boolean; error?: string }>
      computeScriptsSave: (
        request: ComputeScriptsSaveRequestPayload,
      ) => Promise<ComputeScriptsSaveResultPayload>
      computeScriptsList: () => Promise<ComputeScriptsListResultPayload>
      computeScriptsLoad: (
        name: string,
      ) => Promise<ComputeScriptsLoadResultPayload>
      libraryListPapers: (
        query: LibraryListPapersQueryPayload,
      ) => Promise<LibraryListPapersResultPayload>
      libraryGetPaper: (
        id: number,
      ) => Promise<{ paper: LibraryPaperRowPayload | null; error?: string }>
      libraryAddPaper: (
        input: LibraryAddPaperInputPayload,
      ) => Promise<LibraryAddPaperResultPayload>
      libraryDeletePaper: (
        id: number,
      ) => Promise<LibraryDeletePaperResultPayload>
      libraryListTags: () => Promise<LibraryTagEntryPayload[]>
      libraryAddTag: (
        paperId: number,
        tag: string,
      ) => Promise<LibraryAddTagResultPayload>
      libraryRemoveTag: (
        paperId: number,
        tag: string,
      ) => Promise<LibraryRemoveTagResultPayload>
      libraryListCollections: () => Promise<LibraryCollectionEntryPayload[]>
      libraryCreateCollection: (
        input: LibraryCreateCollectionInputPayload,
      ) => Promise<LibraryCreateCollectionResultPayload>
      libraryDeleteCollection: (
        name: string,
      ) => Promise<LibrarySimpleResultPayload>
      libraryAddToCollection: (
        name: string,
        paperId: number,
      ) => Promise<LibrarySimpleResultPayload>
      libraryRemoveFromCollection: (
        name: string,
        paperId: number,
      ) => Promise<LibrarySimpleResultPayload>
      libraryStats: () => Promise<LibraryStatsPayload>
      libraryImportPdf: (
        input: LibraryImportPdfRequestPayload,
      ) => Promise<LibraryImportPdfResultPayload>
      libraryDownloadAndImportPdf: (
        input: LibraryDownloadAndImportPdfRequestPayload,
      ) => Promise<LibraryDownloadAndImportPdfResultPayload>
      libraryScanDirectory: (
        input: LibraryScanDirectoryRequestPayload,
      ) => Promise<LibraryScanDirectoryResultPayload>
      libraryRefreshMetadata: () => Promise<LibraryRefreshMetadataResultPayload>
      libraryReadPdfBytes: (
        input: LibraryReadPdfBytesRequestPayload,
      ) => Promise<LibraryReadPdfBytesResultPayload>
      workerStatus: () => Promise<WorkerStatusPayload>
      workerStart: () => Promise<WorkerStartResultPayload>
      workerCall: (
        req: WorkerCallRequestPayload,
      ) => Promise<WorkerCallResultPayload>
      workerHealth: () => Promise<WorkerCallResultPayload>
      workerStop: () => Promise<{ success: true }>
      onWorkerStatus: (
        callback: (status: WorkerStatusPayload) => void,
      ) => () => void
      onWorkerEvent: (
        callback: (event: WorkerEventPayload) => void,
      ) => () => void
      /** Fire-and-forget local audit event. Main process buffers and writes
       *  it asynchronously; renderer callers must not await for correctness. */
      auditRecord: (payload: ApiCallAuditPayload) => Promise<{ ok: true }>
      libraryListAnnotations: (
        paperId: number,
      ) => Promise<LibraryListAnnotationsResultPayload>
      libraryAddAnnotation: (
        paperId: number,
        body: unknown,
      ) => Promise<LibraryAddAnnotationResultPayload>
      libraryUpdateAnnotation: (
        annId: number,
        patch: unknown,
      ) => Promise<LibraryUpdateAnnotationResultPayload>
      libraryDeleteAnnotation: (
        annId: number,
      ) => Promise<LibraryDeleteAnnotationResultPayload>
      onComputeStdout: (
        callback: (msg: ComputeStreamChunkPayload) => void,
      ) => () => void
      onComputeStderr: (
        callback: (msg: ComputeStreamChunkPayload) => void,
      ) => () => void
      onComputeExit: (
        callback: (msg: ComputeExitEventPayload) => void,
      ) => () => void
      issueApprovalToken: (
        req: ApprovalTokenIssueRequest,
      ) => Promise<ApprovalTokenIssueResult>
      auditGetStatus: () => Promise<AuditStatusPayload>
      auditConfigure: (
        payload: AuditConfigurePayload,
      ) => Promise<AuditStatusPayload>
      auditOpenLogDir: () => Promise<AuditSimpleResult>
      auditClearLogs: () => Promise<AuditSimpleResult>
      auditExportLogs: () => Promise<AuditExportResult>
      appUpdateGetStatus: () => Promise<AppUpdateStatusPayload>
      appUpdateCheck: () => Promise<AppUpdateStatusPayload>
      appUpdateOpenRelease: () => Promise<AppUpdateOpenReleaseResult>
      // ─── Workspace bash ──────────────────────────────────────────
      workspaceBash: (
        req: WorkspaceBashRequest,
      ) => Promise<WorkspaceBashResult>
      onWorkspaceBashChunk: (
        callback: (msg: WorkspaceBashChunkEvent) => void,
      ) => () => void
      onWorkspaceBashDone: (
        callback: (msg: WorkspaceBashDoneEvent) => void,
      ) => () => void
      /** Compute overlay-scoped listing — lists an arbitrary absolute
       *  directory without touching the global workspace root. */
      computeListDirAt: (absPath: string) => Promise<
        | {
            ok: true
            rootPath: string
            entries: Array<{
              name: string
              relPath: string
              parentRel: string
              isDirectory: boolean
              size: number
              mtime: number
            }>
          }
        | { ok: false; error: string }
      >
      computeReadFileAt: (
        rootPath: string,
        relPath: string,
      ) => Promise<
        | { ok: true; content: string; size: number }
        | { ok: false; error: string }
      >
      computeRevealAt: (
        absPath: string,
      ) => Promise<{ ok: boolean; error?: string }>
      computeCopyPathAt: (
        absPath: string,
      ) => Promise<{ ok: boolean; error?: string }>
      workspaceCopyPath: (rel: string) => Promise<{ ok: boolean; error?: string }>
      workspaceRevealInFolder: (
        rel: string,
      ) => Promise<{ ok: boolean; error?: string }>
      workspaceOpenInSystem: (
        rel: string,
      ) => Promise<{ ok: boolean; error?: string }>
      openWorkbenchWindow: (payload: {
        sessionId: string
        artifactId: string
      }) => Promise<{ success: boolean; error?: string }>
      closeWorkbenchWindow: () => Promise<{ success: boolean }>
      openLibraryWindow: () => Promise<{ success: boolean; error?: string }>
      closeLibraryWindow: () => Promise<{ success: boolean }>
      librarySendPaperToMain: (
        payload: LibraryOpenPaperIpcPayload,
      ) => void
      onLibraryOpenPaper: (
        callback: (payload: LibraryOpenPaperIpcPayload) => void,
      ) => () => void
      // ─── Cloud sync ──────────────────────────────────────────────
      syncSetup: (req: SyncSetupRequest) => Promise<SyncSimpleResult>
      syncTestConnection: (
        req?: SyncSetupRequest,
      ) => Promise<SyncTestConnectionResult>
      syncStatus: () => Promise<SyncStatusResult>
      syncPush: (opts?: SyncPushPullOpts) => Promise<SyncPushResult>
      syncPull: (opts?: SyncPushPullOpts) => Promise<SyncPullResult>
      syncGetConfig: () => Promise<SyncConfigResult>
      syncSetAutoPush: (enabled: boolean) => Promise<SyncSimpleResult>
      syncSetAutoPull: (enabled: boolean) => Promise<SyncSimpleResult>
      syncSetInterval: (minutes: number) => Promise<SyncSimpleResult>
      syncSetExcludedRoots: (roots: string[]) => Promise<SyncSimpleResult>
      syncFolderStats: () => Promise<SyncFolderStatsResult>
      syncSetRemoteRoot: (folder: string) => Promise<SyncSimpleResult>
      syncDisableAuto: () => Promise<SyncSimpleResult>
      // ─── Research persistence ────────────────────────────────────
      researchPersist: (
        payload: ResearchPersistRequest,
      ) => Promise<SyncSimpleResult>
      researchDelete: (
        payload: ResearchDeleteRequest,
      ) => Promise<SyncSimpleResult>
      researchList: () => Promise<ResearchListResult>
      researchExportPdf: (
        payload: ResearchExportPdfRequest,
      ) => Promise<ResearchExportPdfResult>
      platform: string
    }
  }
}

// ─── Research-report mirror payloads ────────────────────────────────

export interface ResearchPersistRequest {
  sessionId: string
  artifactId: string
  payload: unknown
  kind: string
  updatedAt: number
}

export interface ResearchDeleteRequest {
  sessionId: string
  artifactId: string
}

export type ResearchListResult =
  | {
      ok: true
      items: Array<{
        sessionId: string
        artifactId: string
        payload: unknown
        kind: string
        updatedAt: number
      }>
    }
  | { ok: false; error: string }

// ─── Cloud sync payloads ────────────────────────────────────────────

export type SyncBackendKind = 'webdav' | 'rclone'

export interface SyncSetupRequest {
  backend: SyncBackendKind
  remoteUrl: string
  username?: string
  password?: string
}

export interface SyncConflict {
  path: string
  localSize: number
  localMtime: string
  remoteSize: number
  remoteMtime: string
}

export interface SyncSkippedEntry {
  path: string
  reason: 'too_large' | 'conflict' | 'excluded' | 'unchanged' | 'error'
  detail?: string
}

export interface SyncErrorEntry {
  path: string
  msg: string
}

export interface SyncPushPullOpts {
  force?: boolean
  paths?: string[]
}

export type SyncSimpleResult =
  | { ok: true }
  | { ok: false; error: string }

export type SyncTestConnectionResult =
  | { ok: true; backend: SyncBackendKind; remoteUrl: string }
  | { ok: false; error: string }

export type SyncStatusResult =
  | {
      ok: true
      configured: boolean
      backend: SyncBackendKind | ''
      remoteUrl: string
      lastSync: string
      autoPush: boolean
      autoPull: boolean
      toPush: string[]
      toPull: string[]
      conflicts: SyncConflict[]
      synced: number
    }
  | { ok: false; error: string }

export type SyncPushResult =
  | {
      ok: true
      uploaded: string[]
      skipped: SyncSkippedEntry[]
      conflicts: SyncConflict[]
      errors: SyncErrorEntry[]
    }
  | { ok: false; error: string }

export type SyncPullResult =
  | {
      ok: true
      downloaded: string[]
      renamedAsConflict: string[]
      skipped: SyncSkippedEntry[]
      errors: SyncErrorEntry[]
    }
  | { ok: false; error: string }

export type SyncConfigResult =
  | {
      ok: true
      configured: boolean
      backend: SyncBackendKind | ''
      remoteUrl: string
      username: string
      autoPush: boolean
      autoPull: boolean
      lastSync: string
      syncInterval: number
      excludedRoots: string[]
      remoteRoot: string
    }
  | { ok: false; error: string }

export interface SyncFolderStats {
  root: string
  fileCount: number
  totalBytes: number
  toPush: number
  toPull: number
  conflicts: number
}

export type SyncFolderStatsResult =
  | { ok: true; folders: SyncFolderStats[] }
  | { ok: false; error: string }

// ─── Workspace bash payload ────────────────────────────────────────

export interface ApprovalTokenIssueRequest {
  toolName: string
  ttlMs?: number
  scope?: Record<string, unknown>
}

export type ApprovalTokenIssueResult =
  | { ok: true; token: string; expiresAt: number }
  | { ok: false; error: string }

export interface WorkspaceBashRequest {
  workspaceDir: string
  command: string
  timeoutMs?: number
  /** Opt-in to streaming. When set, the main process emits
   *  `workspace:bash-chunk` (line-buffered, 50 ms throttled) and a final
   *  `workspace:bash-done` carrying the same id. The Promise result is
   *  unchanged — streaming is purely a side-channel for progress UI. */
  invocationId?: string
  approvalToken: string
}

export type WorkspaceBashResult =
  | {
      success: true
      exitCode: number
      stdout: string
      stderr: string
    }
  | {
      success: false
      error?: string
      exitCode?: number
      stdout?: string
      stderr?: string
    }

export interface WorkspaceBashChunkEvent {
  invocationId: string
  stream: 'stdout' | 'stderr'
  /** One or more complete lines (ending with '\n'), or the final partial
   *  tail when the child closes without a trailing newline. */
  data: string
}

export interface WorkspaceBashDoneEvent {
  invocationId: string
  status: 'ok' | 'error' | 'timeout'
  exitCode: number | null
}
