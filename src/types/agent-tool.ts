// Local agent tool contract.
//
// The orchestrator (`src/lib/agent-orchestrator.ts`) drives a multi-turn
// loop: it sends the user's prompt + tool schemas to the LLM, parses any
// `tool_use` blocks out of the response, executes the matching LocalTool,
// feeds the result back as a `tool_result` block, and asks the LLM again
// — up to `MAX_ITERATIONS` turns. This makes "Agent mode" truly agentic
// without any backend round-trips.
//
// Tool authors implement one `LocalTool` per named action; catalog entries
// live under `src/lib/agent-tools/` and register themselves through
// `LOCAL_TOOL_CATALOG`. The Anthropic API accepts our `inputSchema` shape
// verbatim (see their docs on `tool_use`), and `electron/llm-proxy.ts`
// translates it to OpenAI's `tools: [{type:'function', function: …}]`
// format on the wire.

export interface ToolInputSchema {
  type: 'object'
  properties: Record<string, { type: string; description?: string }>
  required?: string[]
}

/** TrustLevel gates tool execution in the orchestrator. Mirrors
 *  lattice-cli's `approval.py`:
 *   - `safe`       read-only / metadata; runs silently.
 *   - `sandboxed`  backend compute with no host-side write; runs silently
 *                  but surfaces a tag in TaskTimeline.
 *   - `localWrite` mutates artifacts / session state; the user can opt
 *                  into per-call confirmation via prefs.agentApproval.
 *   - `hostExec`   writes files on the host or spawns scripts; ALWAYS
 *                  prompts unless the user has granted a session-scoped
 *                  allow-list.
 *
 *  Default when omitted: `safe`. */
export type TrustLevel = 'safe' | 'sandboxed' | 'localWrite' | 'hostExec'

/** Phase α — post-execution approval gate. `'require'` pauses the agent
 *  loop after the tool runs so the user can inspect (and optionally edit)
 *  the raw output before it is returned to the LLM as a `tool_result`.
 *  Default when omitted: `'auto'` — no gate. Re-exported from `session.ts`
 *  because both the tool catalog and the store need the same enum. */
export type ToolApprovalPolicy = 'auto' | 'require'

/** Phase ε — unified card presentation mode for a tool's output.
 *   - `'silent'` NO card in the chat. The tool still runs and its output
 *                still flows back to the LLM; the step is stored on the
 *                transcript but only surfaces through the per-assistant-
 *                message "used N tools" audit chip. Reserve for pure
 *                retrieval / meta tools the user doesn't want to see
 *                clutter the conversation with.
 *   - `'info'`   read-only preview; no gate, no buttons.
 *   - `'review'` approval gate (Approve / Reject); no editor. The raw
 *                tool output passes through unchanged on approve.
 *   - `'edit'`   approval gate + registered editor. The user's edited
 *                payload replaces the raw output before being fed back
 *                to the LLM.
 *  Default when omitted: `'info'`.
 *  Back-compat: a tool with the legacy `approvalPolicy: 'require'`
 *  behaves as `cardMode: 'edit'` in the orchestrator. */
export type CardMode = 'silent' | 'info' | 'review' | 'edit'

/**
 * Handle used by tools that must prompt the user (ask_user_question) or
 * request execution approval (approval gate). The orchestrator provides
 * these as closures over the session-store's pending-question /
 * pending-approval slices; tool authors just `await` them.
 */
export interface ToolUserInterface {
  /** Prompt the user with a question. The Promise resolves with the user's
   *  free-text answer (or the chosen option id). Rejects with
   *  `Error('user_denied')` when the user closes the dialog. */
  askUser(question: {
    title: string
    detail?: string
    options?: Array<{ id: string; label: string; detail?: string }>
    placeholder?: string
  }): Promise<{ answerId?: string; answerText?: string }>
}

/** Progress event a tool can report out-of-band while `execute` is still
 *  running. The orchestrator forwards these over `wsClient.dispatch(
 *  'tool_progress', …)` so a UI timeline can render partial output without
 *  waiting for the tool to resolve. The tool's final return value still
 *  carries the complete result — progress is purely additive.
 *
 *  `kind` is a discriminant so new progress shapes can be added without
 *  breaking existing consumers; unknown kinds should be ignored. */
export type ToolProgress =
  | {
      kind: 'bash-output'
      stream: 'stdout' | 'stderr'
      /** One or more complete lines, or the final partial tail at close. */
      data: string
    }
  | {
      kind: 'status'
      message: string
    }

export interface ToolExecutionContext {
  sessionId: string
  /** Cooperative cancellation — long-running tools should check
   *  `signal.aborted` periodically and throw if set. Instantly-resolving
   *  read tools can ignore it. */
  signal: AbortSignal
  /** UI hooks — see {@link ToolUserInterface}. Optional because some call
   *  sites (raw unit tests, server-side execution) won't provide them; tools
   *  that need them should throw a clear error when undefined. */
  ui?: ToolUserInterface
  /** Out-of-band progress channel. Undefined when the caller didn't wire
   *  one up (unit tests, non-orchestrator execution) — tools should treat
   *  it as best-effort and never rely on it for correctness. */
  reportProgress?: (progress: ToolProgress) => void
  /** Phase 7a — workspace-first ctx. Phase 7c tools may call
   *  `orchestrator.emitArtifact(...)` / `emitTranscript(...)` to persist
   *  their output as workspace envelopes instead of mutating session-store.
   *  Undefined when the orchestrator ran headless or without a workspace
   *  binding; tools that need it must guard the access. See
   *  `src/lib/agent/orchestrator-ctx.ts`. */
  orchestrator?: import('../lib/agent/orchestrator-ctx').OrchestratorCtx
}

export interface LocalTool<Input = unknown, Output = unknown> {
  name: string
  description: string
  inputSchema: ToolInputSchema
  /** Default `safe` when omitted. See {@link TrustLevel}. */
  trustLevel?: TrustLevel
  /**
   * Names of input-schema fields that the orchestrator may auto-fill from
   * session context when the LLM omits them. The field must exist in
   * `inputSchema.properties`. Supported keys (resolved in
   * `agent-tools/context-injection.ts`):
   *   - `artifactId` → session.focusedArtifactId
   *   - `sessionId`  → ctx.sessionId
   *   - `elements`   → focused XRD/XPS workbench's `params.phaseSearch.elements`
   *                    or `params.quantify.elements`
   */
  contextParams?: string[]
  /** Tools marked `planModeAllowed: true` remain callable when the session
   *  is in plan mode. Everything else is filtered out until the LLM calls
   *  `exit_plan_mode`. Defaults to false. */
  planModeAllowed?: boolean
  /** Tools marked `extended: true` are NOT in the default catalog. They are
   *  returned only via `tool_search(query)`; once the LLM calls one by
   *  name, the orchestrator resolves it through `findLocalTool`. Keeps
   *  the default schema list small. */
  extended?: boolean
  /**
   * Phase α — human-in-the-loop gate applied **after** a successful
   * `execute()`. When set to `'require'`, the orchestrator stamps the
   * step with `approvalState: 'pending'` and blocks until the user
   * approves / edits / rejects via the ToolCallCard. Default `'auto'`
   * (no gate). Errors short-circuit the gate — failed tools surface
   * their error to the LLM as before.
   */
  approvalPolicy?: ToolApprovalPolicy
  /**
   * Phase ε — unified card mode. Orchestrator gates the loop post-
   * execution when this is `'review'` or `'edit'`. When omitted, the
   * legacy `approvalPolicy: 'require'` is treated as `'edit'` for
   * back-compat; otherwise the card renders read-only (`'info'`).
   */
  cardMode?: CardMode
  execute(input: Input, ctx: ToolExecutionContext): Promise<Output>
}

/** Tool call request emitted by the LLM (normalised to our neutral shape).
 *  `id` is the `tool_use_id` / OpenAI `tool_calls[i].id` — the orchestrator
 *  must echo it back in the matching `tool_result`. */
export interface ToolCallRequest {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolCallResult {
  toolUseId: string
  output: unknown
  isError?: boolean
}
