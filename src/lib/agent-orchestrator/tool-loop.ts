// Single-step executor for the agent loop.
//
// Handles one `tool_use` block emitted by the model: emits the
// `tool_invocation` event, looks the tool up, runs the pre/post approval
// gates, invokes `tool.execute`, normalises thrown errors into an
// `isError` step, then emits `tool_result`. The outer loop in
// `agent-orchestrator.ts` stays focused on LLM round-tripping and
// message assembly; everything specific to a single tool call lives
// here.

import { wsClient } from '../../stores/ws-client'
import { useRuntimeStore } from '../../stores/runtime-store'
import { injectContext } from '../agent-context-injection'
import type {
  LocalTool,
  ToolCallRequest,
  ToolProgress,
  ToolUserInterface,
} from '../../types/agent-tool'
import type { OrchestratorCtx } from '../agent/orchestrator-ctx'
import {
  collectArtifactIds,
  summarizeToolInput,
  summarizeToolOutput,
} from './envelope'
import { awaitApprovalIfRequired, checkApproval } from './approval'
import { throwIfAborted } from './utils'
import type { AgentToolStep } from './types'

export interface ExecuteToolCallArgs {
  call: ToolCallRequest
  /** Pre-computed id matching `genStepId(iteration, index, call.id)`. */
  stepId: string
  taskId: string
  sessionId: string
  /** Full catalog — includes plan-mode-hidden tools so we can return
   *  `plan_mode_blocked` instead of "unknown tool". */
  tools: LocalTool[]
  signal: AbortSignal
  ui: ToolUserInterface
  orchestratorCtx: OrchestratorCtx
}

/**
 * Execute a single tool call end-to-end: announce, validate, gate,
 * invoke, gate again, announce. Returns the resulting {@link AgentToolStep}
 * — success or error — which the caller folds into the next LLM turn
 * as a `tool_result` block.
 *
 * Errors from any stage (unknown tool, plan-mode block, pre-approval
 * denial, `execute()` throw, post-approval rejection) are captured on
 * the step with `isError: true`. AbortSignal aborts still throw so the
 * outer loop's try/catch can emit `task_end: cancelled`.
 */
export async function executeToolCall(
  args: ExecuteToolCallArgs,
): Promise<AgentToolStep> {
  const { call, stepId, taskId, sessionId, tools, signal, ui, orchestratorCtx } =
    args

  throwIfAborted(signal)

  wsClient.dispatch('tool_invocation', {
    task_id: taskId,
    step_id: stepId,
    session_id: sessionId,
    tool_name: call.name,
    input_summary: summarizeToolInput(call.input),
    // Phase 1 · tool-card coverage — pass the structured args through
    // so the session store can hold onto them for card rendering.
    // `input_summary` remains the short human label.
    input: call.input,
  })

  // Tools that were hidden by plan-mode filtering are still resolvable
  // by name so we can reject cleanly (vs silently dropping). Use the
  // full catalog for lookup.
  const tool = tools.find((entry) => entry.name === call.name)
  let step: AgentToolStep
  try {
    if (!tool) throw new Error(`Unknown tool: ${call.name}`)
    // Plan-mode: only whitelisted tools may execute. Anything else comes
    // back as `plan_mode_blocked` so the LLM can course-correct.
    const sessionNow = useRuntimeStore.getState().sessions[sessionId]
    if (sessionNow?.planMode?.active && tool.planModeAllowed !== true) {
      throw new Error(
        `plan_mode_blocked: tool "${tool.name}" cannot run in plan mode. Call exit_plan_mode first.`,
      )
    }
    const injected = injectContext(tool, call.input, { sessionId })
    const approval = await checkApproval(tool, injected)
    if (!approval.allow) {
      throw new Error(approval.reason ?? 'user_denied')
    }
    const reportProgress = (progress: ToolProgress): void => {
      wsClient.dispatch('tool_progress', {
        task_id: taskId,
        step_id: stepId,
        session_id: sessionId,
        tool_name: call.name,
        progress,
      })
    }
    const rawOutput = await tool.execute(injected, {
      sessionId,
      signal,
      ui,
      reportProgress,
      orchestrator: orchestratorCtx,
    })
    // Post-execution approval gate. Runs only on success, so a thrown
    // tool error keeps the short-circuit path (bubble the message
    // straight back to the LLM as `isError`).
    const gated = await awaitApprovalIfRequired({
      tool,
      rawOutput,
      taskId,
      stepId,
      sessionId,
      toolName: call.name,
      signal,
    })
    if (gated.rejected) {
      step = {
        toolUseId: call.id,
        name: call.name,
        input: injected,
        output: 'User rejected the output; do not continue.',
        isError: true,
      }
    } else {
      step = {
        toolUseId: call.id,
        name: call.name,
        input: injected,
        output: gated.output,
      }
    }
  } catch (err) {
    step = {
      toolUseId: call.id,
      name: call.name,
      input: call.input,
      output: err instanceof Error ? err.message : String(err),
      isError: true,
    }
  }

  wsClient.dispatch('tool_result', {
    task_id: taskId,
    step_id: stepId,
    session_id: sessionId,
    tool_name: call.name,
    status: step.isError ? 'failed' : 'succeeded',
    output_summary: summarizeToolOutput(step.output),
    // Pass the structured output through so tool-specific card previews
    // (WorkspaceGlobPreview, DetectPeaksPreview, …) can render a proper
    // oneLiner + body. Without this the renderer only gets the
    // truncated JSON summary and falls back to the generic
    // "· {"files":[],...}" header, which is the noise the user sees in
    // the chat.
    output: step.output,
    artifact_ids: collectArtifactIds(call.input, step.output),
  })

  return step
}
