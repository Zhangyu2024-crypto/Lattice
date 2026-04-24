// Type surface + loop-ceiling constants for the local agent orchestrator.
//
// Kept separate from the entry module so helpers (envelope / approval /
// tool-loop) can import the `AgentToolStep` shape without pulling in the
// driver itself.

import type { LocalTool, ToolCallResult } from '../../types/agent-tool'
import type { MentionRef } from '../../types/mention'
import type { TranscriptMessage } from '../../types/session'

export interface AgentToolStep extends ToolCallResult {
  name: string
  input: Record<string, unknown>
}

export interface RunAgentTurnArgs {
  sessionId: string
  userMessage: string
  /** Optional vision attachments for this user turn only. */
  images?: ReadonlyArray<{ base64: string; mediaType: string }>
  mentions?: Array<{ anchor: string; ref: MentionRef }>
  transcript: TranscriptMessage[]
  tools: LocalTool[]
  /** Optional streaming hook — called once per LLM iteration with any new
   *  assistant text, so callers can update a placeholder message as the
   *  loop progresses. */
  onStreamAppend?: (textDelta: string) => void
  signal?: AbortSignal
  /** Transcript message id the task should be rooted at (so the Task
   *  Timeline can anchor its "jump to message" affordance). */
  rootMessageId?: string
  /** Absolute safety ceiling on the plan→tool→result→reason loop. Normal
   *  termination is (a) the model emitting a plain text turn, or (b) the
   *  loop detector tripping on repeated identical tool calls. This bound
   *  only matters for pathological cases where neither fires. Defaults to
   *  ABSOLUTE_MAX_ITERATIONS (100) and is clamped to that ceiling. */
  maxIterations?: number
  /** Per-turn model binding override, threaded into every `sendLlmChat`
   *  call this loop makes. Wins over session-level `/model` / `/fast` /
   *  `/effort`. See `src/lib/model-routing/` for resolution rules. */
  modelBindingOverride?: import('../model-routing').ModelBinding
}

export interface RunAgentTurnResult {
  success: boolean
  finalText: string
  toolSteps: AgentToolStep[]
  error?: string
  /** Concatenated thinking content from extended-thinking responses across
   *  all iterations. Only present when the model produced thinking blocks. */
  thinkingContent?: string
}

/** Absolute runaway ceiling. Natural termination comes from (a) the model
 *  emitting a plain text turn or (b) the loop detector tripping on
 *  repeated identical tool calls — 100 is just a final safety net so a
 *  truly broken agent can't bill forever. */
export const ABSOLUTE_MAX_ITERATIONS = 100
/** How many consecutive iterations with *identical* tool-call signatures
 *  count as a stuck loop. A legitimate multi-step task re-uses tools
 *  freely, but the same tool with the same args firing N turns in a row
 *  is the classic "model stuck on one subgoal" pattern. */
export const LOOP_DETECT_WINDOW = 3
