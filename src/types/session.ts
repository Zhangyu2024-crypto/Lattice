import type { Artifact, ArtifactId } from './artifact'
import type { MentionAnchor, MentionElementKind, MentionRef } from './mention'

export type SessionId = string
export type TaskId = string
export type TaskStepId = string
export type TranscriptId = string

export interface SessionFile {
  relPath: string
  spectrumType?: string | null
  size?: number | null
  importedAt: number
}

export type TranscriptRole = 'user' | 'assistant' | 'system'

/** Inline images the user attached in the composer (persisted as base64). */
export interface TranscriptAttachedImage {
  mediaType: string
  base64: string
}

/**
 * A single message in a session transcript. New @-mention plumbing lives on
 * {@link TranscriptMessage.mentions}; `artifactRefs` is retained only so we
 * can still render historical data rehydrated from older localStorage.
 */
export interface TranscriptMessage {
  id: TranscriptId
  role: TranscriptRole
  content: string
  /**
   * Structured mentions attached to this message. Each entry's `anchor` is
   * intended to match an `@[label#anchor](mention://…)` token inside
   * {@link TranscriptMessage.content}; anchors are unique **within this one
   * message**, not across the transcript.
   */
  mentions?: Array<{
    anchor: MentionAnchor
    ref: MentionRef
  }>
  /** User-attached images for this turn (multimodal composer). */
  attachedImages?: TranscriptAttachedImage[]
  timestamp: number
  taskId?: TaskId
  /**
   * Extended thinking content from the model's chain-of-thought reasoning.
   * Only populated for assistant messages when the LLM was invoked with
   * `reasoningEffort` set to 'medium' or 'high' and the model produced
   * thinking blocks. Displayed in a collapsible section above the reply.
   */
  thinking?: string
  /**
   * Streaming lifecycle marker for a transcript message. The WS layer sets
   * this to `'streaming'` when a bubble is first appended from a
   * `chat_message` event that may still receive `chat_message_update`
   * deltas; it flips to `'complete'` when an update arrives without a
   * `content_delta` (terminal patch) or the upstream status is not
   * `running`. `'error'` is reserved for protocol-level failures surfaced
   * by the backend. Absence is treated as `'complete'` by readers so older
   * persisted transcripts rehydrate cleanly.
   *
   * OPEN PROTOCOL QUESTION: Backend currently emits both `content_delta`
   * (accumulate) and `content` (replace) on `chat_message_update`; we honor
   * both. This field is the contract we plan to propose upstream.
   */
  status?: 'streaming' | 'complete' | 'error'
  /**
   * @deprecated Superseded by {@link TranscriptMessage.mentions}. Will be
   * removed one minor version after MP-2 lands (see
   * docs/CHAT_PANEL_REDESIGN.md §6.1 / R5). Readers must prefer `mentions`
   * and only fall back to `artifactRefs` when the former is absent.
   */
  artifactRefs?: ArtifactId[]
  /**
   * Phase δ — when present, the transcript renderer swaps the usual
   * markdown body for a compact inline card referencing `artifactId`. Used
   * so demo loads, Pro-workbench spawns, and other "I created an artifact"
   * events surface visually in the chat-first workspace instead of
   * disappearing silently into the session store.
   */
  artifactCardRef?: {
    artifactId: ArtifactId
    /** Optional override label; default uses the artifact's own title. */
    label?: string
  }
}

export type TaskStepKind = 'plan' | 'reasoning' | 'tool_call' | 'summary'
export type TaskStepStatus =
  | 'planned'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'

/**
 * Phase α — per-tool approval policy. Tools marked `'require'` pause the
 * agent loop after execution so the user can inspect (and optionally edit)
 * the raw output before it is fed back to the LLM. `'auto'` tools run
 * through the legacy path with no gate. See agent-orchestrator.ts for the
 * promise-based wait mechanism.
 */
export type ToolApprovalPolicy = 'auto' | 'require'

/**
 * Lifecycle of a human-in-the-loop approval on a tool-call step. `pending`
 * — awaiting the user's choice; `approved` — user accepted (possibly with
 * an edited output); `rejected` — user refused and the agent was told to
 * stop. Absence means the step didn't require approval in the first place.
 */
export type StepApprovalState = 'pending' | 'approved' | 'rejected'

export interface TaskStep {
  id: TaskStepId
  kind: TaskStepKind
  status: TaskStepStatus
  label: string
  toolName?: string
  inputSummary?: string
  /**
   * Phase 1 · tool-card coverage — raw input args the tool was invoked
   * with. Captured at `tool_invocation` dispatch time so info / review
   * cards can render the exact parameters the LLM sent, not just the
   * truncated {@link TaskStep.inputSummary}. Absence means the source
   * event didn't carry a structured input payload (e.g. legacy mock
   * streams) or the step is not a `tool_call`.
   */
  input?: unknown
  outputSummary?: string
  /** Mentions the agent consumed when planning/executing this step. */
  inputMentions?: MentionRef[]
  /** Mentions the step produced — a superset of the legacy
   *  {@link TaskStep.artifactRef} that can also carry element-level output. */
  outputMentions?: MentionRef[]
  /**
   * @deprecated Superseded by {@link TaskStep.outputMentions}. Will be
   * removed one minor version after MP-2 lands.
   */
  artifactRef?: ArtifactId
  /**
   * Phase α — raw tool output captured when the orchestrator asked for
   * approval. Editor cards read this as their initial state; the approved
   * value (possibly mutated) is fed back to the LLM as the tool_result.
   * `outputSummary` remains a short human-readable string for the
   * collapsed card row.
   */
  output?: unknown
  /** Phase α — approval lifecycle; absent when the tool was `auto`. */
  approvalState?: StepApprovalState
  /** Phase α — user-adjusted version of {@link TaskStep.output}. Replaces
   *  the raw output as the tool_result when approval resolves. */
  editedOutput?: unknown
  /**
   * Phase α — stable identifier the orchestrator stamped on the dispatched
   * `tool_invocation` / `tool_result` WS events. The session store uses
   * it to match the user's approval decision back to the module-level
   * pending-approval resolver in agent-orchestrator.ts.
   */
  backendStepId?: string
  startedAt: number
  endedAt?: number
}

/**
 * The "currently inspected" sub-object inside a focused artifact. Drives the
 * right-side InspectorRail and (later, MP-3) the canvas highlight bus. Set
 * when the user clicks a row in a peak table / phase list / XPS component
 * list; cleared when the focused artifact changes.
 */
export interface FocusedElementTarget {
  artifactId: ArtifactId
  elementKind: MentionElementKind
  elementId: string
  /** Optional cold-render label (e.g. "Peak 3"). Renderers should not depend
   *  on this for matching — it's a UI hint only. */
  label?: string
}

export type TaskStatus = 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface Task {
  id: TaskId
  sessionId: SessionId
  title: string
  rootMessageId?: TranscriptId
  status: TaskStatus
  steps: TaskStep[]
  startedAt: number
  endedAt?: number
}

export type ConversationMode = 'dialog' | 'agent' | 'research'

export interface ConversationResearchState {
  outline?: string
  sectionStatus?: Record<string, 'pending' | 'drafting' | 'done'>
  /** Artifact id of the produced research-report artifact, if any. */
  reportArtifactId?: ArtifactId
}

export interface Session {
  id: SessionId
  title: string
  createdAt: number
  updatedAt: number
  /** Timestamp when the user pinned this chat to the top of
   *  ChatsDropdown's Pinned section. Undefined = not pinned. Drives
   *  the sort in the dropdown's Pinned group. */
  pinnedAt?: number
  /** When non-null, the chat is archived: hidden from the default
   *  Recent list, surfaced in the Archived tab. Undefined = active. */
  archivedAt?: number
  files: SessionFile[]
  artifacts: Record<ArtifactId, Artifact>
  artifactOrder: ArtifactId[]
  pinnedArtifactIds: ArtifactId[]
  focusedArtifactId: ArtifactId | null
  /** Optional sub-object selection within the focused artifact. Auto-cleared
   *  whenever {@link Session.focusedArtifactId} changes. */
  focusedElement?: FocusedElementTarget | null
  /** Last `spectrum-pro` artifact this session focused per technique
   *  cursor (xrd, xps, curve). Drives the "open workbench AND run
   *  command" path in the App-level command palette: pick up where the
   *  user left off on that technique instead of always spawning a new
   *  artifact. Cleared transparently when the referenced artifact goes
   *  away. */
  lastFocusedProByTechnique?: Partial<Record<string, ArtifactId>>
  /** Canonical chat transcript for this session (one thread per session). */
  transcript: TranscriptMessage[]
  /**
   * Chat / agent mode for this session’s single thread. Drives research UI
   * hints and legacy dialog→agent normalization.
   */
  chatMode: ConversationMode
  /** Populated when {@link Session.chatMode} is `research`. */
  researchState?: ConversationResearchState
  tasks: Record<TaskId, Task>
  taskOrder: TaskId[]
  activeTaskId: TaskId | null
  paramSnapshot: Record<string, unknown>
  /**
   * Most-recently-used mention refs for this session, head = most recent.
   * Optional on purpose: older persisted sessions predate MP-2 and must
   * rehydrate without a migration step — readers should treat absence as an
   * empty list. Writers should cap at `RECENT_MENTIONS_MAX` (session-store).
   */
  recentMentions?: MentionRef[]
  /**
   * Phase B+ · plan mode. When `active` is true, the orchestrator filters
   * the tool catalog down to `planModeAllowed` tools so the LLM produces a
   * plan without executing analysis. The user exits via the banner button
   * (which calls `exit_plan_mode`) or the LLM decides to exit itself.
   */
  planMode?: {
    active: boolean
    reason?: string
    plan?: string
    enteredAt?: number
  }
  /**
   * Phase B+ · agent-managed todo list. Separate from `tasks` (which
   * tracks orchestrator run steps); these are high-level items the agent
   * creates with `task_create` to plan its own work.
   */
  agentTasks?: AgentTask[]
}

/** Agent-managed todo item. Produced by `task_create`, updated by
 *  `task_update`. Rendered in TaskTimeline as a checklist. */
export interface AgentTask {
  id: string
  subject: string
  description?: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  createdAt: number
  updatedAt: number
  /** Optional owner label for the task (human-readable). */
  owner?: string
}
