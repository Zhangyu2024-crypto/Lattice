// Local agent orchestrator.
//
// Drives the multi-turn loop that closes the MP-2 mention feature into
// actual agent behaviour:
//
//   1. send user message + mention context + tool schemas to the LLM
//   2. if the response includes `tool_use` blocks, execute each tool
//      locally, append the results as a `tool_result` user message, and
//      call the LLM again
//   3. stop when the model emits a plain text turn (or `MAX_ITERATIONS`
//      is hit, or an external AbortSignal fires)
//
// Every step is announced over `wsClient.dispatch` with the same snake-
// case payload shape the existing `useWebSocket` handlers expect, so the
// TaskTimeline renders the agent's plan in real time without a single
// backend hop. See Self-contained Port Plan §P0.
//
// The driver itself stays in this module. Helpers are grouped under
// `./agent-orchestrator/`:
//   · `types.ts`      – public interfaces + loop ceilings
//   · `utils.ts`      – id generation, abort helpers
//   · `envelope.ts`   – summarisation + LLM message reconstruction
//   · `approval.ts`   – pre- / post-execution approval gates
//   · `tool-loop.ts`  – single tool-call executor

import { wsClient } from '../stores/ws-client'
import { log } from './logger'
import { useAgentDialogStore } from '../stores/agent-dialog-store'
import { useRuntimeStore } from '../stores/runtime-store'
import {
  sendLlmChat,
  transcriptToLlmMessages,
  userMessagePayload,
} from './llm-chat'
import { filterForPlanMode } from './agent-context-injection'
import { resolveToolsForContext } from './agent-tools'
import { clearPendingApprovals } from './agent-orchestrator-approvals'
import { createOrchestratorCtx } from './agent/orchestrator-ctx'
import type { LocalTool, ToolCallRequest } from '../types/agent-tool'
import type {
  LlmMessagePayload,
  LlmToolResultBlockPayload,
} from '../types/electron'
import {
  ABSOLUTE_MAX_ITERATIONS,
  LOOP_DETECT_WINDOW,
  type AgentToolStep,
  type RunAgentTurnArgs,
  type RunAgentTurnResult,
} from './agent-orchestrator/types'
import {
  isStuckLoop,
  iterationSignature,
} from './agent-orchestrator/loop-detect'
import {
  buildIterationControlMessage,
  shouldForceFinalAnswer,
} from './agent-orchestrator/control'
import {
  assistantMessageFromResult,
  summarizeToolOutput,
  toToolResultBlock,
} from './agent-orchestrator/envelope'
import { toolUi } from './agent-orchestrator/approval'
import { executeToolCall } from './agent-orchestrator/tool-loop'
import {
  NEVER_ABORT_SIGNAL,
  genStepId,
  genTaskId,
  throwIfAborted,
} from './agent-orchestrator/utils'
import {
  shouldAutoCompact,
  compactConversation,
  clearOldToolResults,
} from './context-management'

// Re-export the public type surface so existing
// `import { … } from '.../agent-orchestrator'` consumers keep working
// without chasing the split.
export type { AgentToolStep, RunAgentTurnArgs, RunAgentTurnResult }

function extractToolSearchResultNames(output: unknown): string[] {
  if (!output || typeof output !== 'object') return []
  const results = (output as { results?: unknown }).results
  if (!Array.isArray(results)) return []
  return results
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const name = (entry as { name?: unknown }).name
      return typeof name === 'string' && name.length > 0 ? name : null
    })
    .filter((name): name is string => Boolean(name))
}

export async function runAgentTurn(
  args: RunAgentTurnArgs,
): Promise<RunAgentTurnResult> {
  const taskId = genTaskId()
  const toolSteps: AgentToolStep[] = []
  const signal = args.signal ?? NEVER_ABORT_SIGNAL
  // Reset stale pending dialogs from a previous (possibly crashed) turn so
  // the new run doesn't inherit a stuck modal or a dangling approval wait.
  useAgentDialogStore.getState().reset()
  clearPendingApprovals()
  // Phase 7a — snapshot the workspace-first ctx once per turn so every
  // tool sees the same fs/root. Re-reading the workspace-store per tool
  // call would race a mid-turn root switch; a single snapshot matches the
  // observable intent ("user sent this turn against this workspace").
  const orchestratorCtx = createOrchestratorCtx()
  // The loop's primary stop conditions are (a) the model emitting a plain
  // text turn and (b) the loop detector tripping on repeated tool-call
  // signatures. `maxIterations` is just an absolute safety bound for the
  // case where neither fires. Callers can lower it, but we clamp to
  // ABSOLUTE_MAX_ITERATIONS so a caller bug can't remove the safety net.
  const maxIterations = (() => {
    const raw = args.maxIterations
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 1) {
      return ABSOLUTE_MAX_ITERATIONS
    }
    return Math.min(Math.floor(raw), ABSOLUTE_MAX_ITERATIONS)
  })()
  const iterationSignatures: string[] = []
  let finalText = ''
  let thinkingParts: string[] = []
  let messages: LlmMessagePayload[] = [
    ...transcriptToLlmMessages(args.transcript),
    userMessagePayload(args.userMessage, args.images),
  ]
  const discoveredToolNames = new Set<string>()

  /** Compute the active tool catalog for this iteration. Filters by:
   *  1. Plan mode (only whitelisted tools)
   *  2. Session context (only relevant domain tools) */
  const resolveTools = (): LocalTool[] => {
    const session = useRuntimeStore.getState().sessions[args.sessionId]
    if (session?.planMode?.active) return filterForPlanMode(args.tools)

    const artifacts = session ? Object.values(session.artifacts) : []
    const ctx: import('./agent-tools').SessionContext = {
      hasSpectrumArtifacts: artifacts.some(
        (a) => a.kind === 'spectrum-pro' || a.kind === 'xrd-pro' || a.kind === 'xps-pro' || a.kind === 'raman-pro' || a.kind === 'spectrum',
      ),
      hasStructureArtifacts: artifacts.some((a) => a.kind === 'structure'),
      hasComputeArtifacts: artifacts.some((a) => a.kind === 'compute' || a.kind === 'compute-pro'),
      hasResearchArtifacts: artifacts.some((a) => a.kind === 'research-report'),
      hasLatexArtifacts: artifacts.some((a) => a.kind === 'latex-document'),
      hasPapers: artifacts.some((a) => a.kind === 'paper'),
      hasWorkspaceFiles: true,
      hasHypothesisArtifacts: artifacts.some((a) => a.kind === 'hypothesis'),
      userMessage: args.userMessage,
    }
    const filtered = resolveToolsForContext(args.tools, ctx)
    if (discoveredToolNames.size === 0) return filtered
    const byName = new Map(filtered.map((tool) => [tool.name, tool]))
    for (const tool of args.tools) {
      if (discoveredToolNames.has(tool.name)) byName.set(tool.name, tool)
    }
    return [...byName.values()]
  }

  wsClient.dispatch('task_start', {
    task_id: taskId,
    session_id: args.sessionId,
    title: 'Agent Task',
    ...(args.rootMessageId ? { root_message_id: args.rootMessageId } : {}),
  })

  try {
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      throwIfAborted(signal)

      // ── Context management ──────────────────────────────────────────
      // Auto-compact when the conversation is approaching the context
      // window limit. This replaces the full messages array with a
      // structured summary, drastically reducing token count. The
      // history-budget trimmer in llm-chat still runs afterward as a
      // safety net.
      if (shouldAutoCompact(messages)) {
        try {
          const compacted = await compactConversation(
            messages,
            args.sessionId,
            signal,
          )
          messages = compacted.contextMessages
        } catch {
          // Compaction is best-effort — if it fails, continue with the
          // full messages array and let the history-budget trimmer handle
          // overflow. Logging is handled inside compactConversation.
        }
      }

      // Clear old tool results to keep the context lean. The last N
      // results stay intact (the model may still reference them); older
      // ones are replaced with a short sentinel.
      const { messages: clearedMessages } = clearOldToolResults(messages)
      messages = clearedMessages

      const forceFinalAnswer = shouldForceFinalAnswer({
        iteration,
        maxIterations,
        toolStepCount: toolSteps.length,
      })
      const controlMessage = buildIterationControlMessage({
        iteration,
        maxIterations,
        toolStepCount: toolSteps.length,
      })
      const activeTools = forceFinalAnswer ? [] : resolveTools()
      const requestMessages = controlMessage
        ? [...messages, controlMessage]
        : messages
      const llm = await sendLlmChat({
        mode: 'agent',
        userMessage: args.userMessage,
        transcript: args.transcript,
        sessionId: args.sessionId,
        // Mentions are a "user's intent for this turn" signal — only send
        // them on the first LLM call. Subsequent iterations already have
        // the mention context in the prompt via contextBlocks from turn 1;
        // re-sending would duplicate the headers.
        mentions: iteration === 0 ? args.mentions : undefined,
        messages: requestMessages,
        tools: activeTools,
        // Stream text deltas to the caller so the UI updates in real time.
        onTextDelta: args.onStreamAppend,
        // Thread the per-turn model override so every iteration of this
        // loop talks to the same model — swapping mid-turn would confuse
        // tool-use continuity.
        modelBindingOverride: args.modelBindingOverride,
        signal,
      })

      if (!llm.success) {
        wsClient.dispatch('task_end', {
          task_id: taskId,
          session_id: args.sessionId,
          status: signal.aborted ? 'cancelled' : 'failed',
        })
        const combinedThinking = thinkingParts.length > 0 ? thinkingParts.join('\n\n') : undefined
        return {
          success: false,
          finalText,
          toolSteps,
          error: llm.error ?? 'LLM call failed',
          ...(combinedThinking ? { thinkingContent: combinedThinking } : {}),
        }
      }

      // Capture thinking content from each iteration.
      if (llm.thinkingContent) {
        thinkingParts.push(llm.thinkingContent)
      }

      if (llm.content.trim()) {
        const delta = `${finalText ? '\n\n' : ''}${llm.content.trim()}`
        finalText += delta
        args.onStreamAppend?.(delta)
      }

      const toolCalls = llm.toolCalls ?? []
      if (toolCalls.length === 0) {
        wsClient.dispatch('task_end', {
          task_id: taskId,
          session_id: args.sessionId,
          status: 'succeeded',
        })
        const combinedThinking = thinkingParts.length > 0 ? thinkingParts.join('\n\n') : undefined
        return {
          success: true,
          finalText,
          toolSteps,
          ...(combinedThinking ? { thinkingContent: combinedThinking } : {}),
        }
      }

      // Loop detector: if the model is about to repeat the same tool
      // call(s) for the Nth turn in a row, executing would just feed the
      // same result back into its context and stoke the same loop. Bail
      // before we spend another round-trip.
      iterationSignatures.push(iterationSignature(toolCalls))
      if (isStuckLoop(iterationSignatures, LOOP_DETECT_WINDOW)) {
        const error = `Agent stopped: same tool call repeated ${LOOP_DETECT_WINDOW} turns in a row (loop detected)`
        wsClient.dispatch('task_end', {
          task_id: taskId,
          session_id: args.sessionId,
          status: 'failed',
        })
        const combinedThinking = thinkingParts.length > 0 ? thinkingParts.join('\n\n') : undefined
        return {
          success: false,
          finalText,
          toolSteps,
          error,
          ...(combinedThinking ? { thinkingContent: combinedThinking } : {}),
        }
      }

      const assistantMessage = assistantMessageFromResult(llm)
      if (assistantMessage) {
        messages = [...messages, assistantMessage]
      }

      const toolResultBlocks: LlmToolResultBlockPayload[] = []
      for (let index = 0; index < toolCalls.length; index++) {
        const call: ToolCallRequest = toolCalls[index]
        const stepId = genStepId(iteration, index, call.id)
        const step = await executeToolCall({
          call,
          stepId,
          taskId,
          sessionId: args.sessionId,
          tools: args.tools,
          signal,
          ui: toolUi,
          orchestratorCtx,
          onAudit: (event) => {
            const outputSummary = (() => {
              if (event.output == null) return undefined
              try {
                return summarizeToolOutput(event.output)
              } catch {
                return undefined
              }
            })()
            const auditApi =
              typeof window !== 'undefined'
                ? window.electronAPI?.auditRecord
                : undefined
            void auditApi?.({
              kind: 'agent.tool_call',
              source: 'agent',
              operation: event.call.name,
              status: event.status,
              durationMs: event.durationMs,
              sessionId: args.sessionId,
              taskId,
              stepId: event.stepId,
              workspaceRoot: orchestratorCtx.workspaceRoot,
              request: {
                toolName: event.call.name,
                toolUseId: event.call.id,
                trustLevel: event.tool?.trustLevel ?? 'safe',
                cardMode: event.tool?.cardMode,
                input: event.input,
              },
              response: {
                isError: event.status !== 'ok',
                outputSummary,
                output: event.output,
              },
              error: event.error,
            })
          },
        })
        toolSteps.push(step)
        if (step.name === 'tool_search' && !step.isError) {
          for (const name of extractToolSearchResultNames(step.output)) {
            discoveredToolNames.add(name)
          }
        }
        toolResultBlocks.push(toToolResultBlock(step))
      }

      // Next turn: include the tool_result blocks as a single user message
      // (anthropic requires one message with all results; openai splits
      // into multiple `tool` role messages, handled by the proxy).
      messages = [
        ...messages,
        { role: 'user', content: toolResultBlocks },
      ]
    }

    const error = `Agent hit the absolute iteration ceiling (${maxIterations}). Loop detector did not trip, which usually means the model kept picking different tools without converging — inspect the task timeline.`
    log.error(error, {
      source: 'agent',
      type: 'runtime',
      detail: { taskId, sessionId: args.sessionId, iterations: maxIterations },
    })
    wsClient.dispatch('task_end', {
      task_id: taskId,
      session_id: args.sessionId,
      status: 'failed',
    })
    const combinedThinking = thinkingParts.length > 0 ? thinkingParts.join('\n\n') : undefined
    return {
      success: false,
      finalText,
      toolSteps,
      error,
      ...(combinedThinking ? { thinkingContent: combinedThinking } : {}),
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    if (!signal.aborted) {
      log.exception(err, {
        source: 'agent',
        detail: { taskId, sessionId: args.sessionId },
      })
    }
    wsClient.dispatch('task_end', {
      task_id: taskId,
      session_id: args.sessionId,
      status: signal.aborted ? 'cancelled' : 'failed',
    })
    const combinedThinking = thinkingParts.length > 0 ? thinkingParts.join('\n\n') : undefined
    return {
      success: false,
      finalText,
      toolSteps,
      error,
      ...(combinedThinking ? { thinkingContent: combinedThinking } : {}),
    }
  }
}
