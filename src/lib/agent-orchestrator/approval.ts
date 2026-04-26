// Pre- and post-execution approval plumbing for the orchestrator.
//
// Two gates live here:
//
//   - `checkApproval`         runs before `tool.execute()` and consults the
//                             session permission mode + the tool's
//                             declared trust level.
//   - `awaitApprovalIfRequired` runs after a successful `execute()` for
//                             tools whose `cardMode` is `review` or `edit`
//                             and blocks on the UI's approval card.
//
// The UI-facing `toolUi` singleton — what `ToolExecutionContext.ui`
// resolves to — also lives here because it's shaped by the same
// pending-dialog store the approval gates use.

import { wsClient } from '../../stores/ws-client'
import { useAgentDialogStore } from '../../stores/agent-dialog-store'
import { usePrefsStore } from '../../stores/prefs-store'
import { toast } from '../../stores/toast-store'
import {
  getToolApplier,
  isProposalFirstTool,
} from '../../components/agent/tool-cards/applier-registry'
import {
  autoApprovesCard,
  readOnlyBlockedReason,
  trustDecision,
} from '../../types/permission-mode'
import { registerPendingApproval } from '../agent-orchestrator-approvals'
import type {
  CardMode,
  LocalTool,
  ToolUserInterface,
  TrustLevel,
} from '../../types/agent-tool'
import { summarizeToolOutput } from './envelope'

/** UI-facing hooks passed to every tool's ExecutionContext. Backed by
 *  the pending-dialog store; rejects if orchestrator ran in a headless
 *  environment (e.g. unit test) that never mounted the dialogs. */
export const toolUi: ToolUserInterface = {
  async askUser(question) {
    return useAgentDialogStore.getState().requestQuestion(question)
  },
}

/** Phase ε — normalise a tool's presentation mode. Any new tool should
 *  set `cardMode` directly; legacy tools that only set
 *  `approvalPolicy: 'require'` are mapped to `'edit'` for back-compat
 *  so the orchestrator gate and the card UI agree without touching
 *  every catalog entry. Tools that set neither render as `'info'`. */
export function resolveCardMode(tool: LocalTool): CardMode {
  if (tool.cardMode) return tool.cardMode
  if (tool.approvalPolicy === 'require') return 'edit'
  return 'info'
}

/** Decide whether a tool needs user approval and, if so, request it.
 *  Returns true when execution should proceed, false when the user denied.
 *
 *  The session-level permission mode is the single source of truth — we
 *  no longer cross-check the legacy `prefs.agentApproval` (which
 *  defaulted to `localWrite: 'auto'` and silently skipped Normal's
 *  intended pre-exec prompt for any non-proposal-first localWrite tool
 *  like correct_baseline / plot_spectrum). See
 *  `src/types/permission-mode.ts` for the matrix. */
export async function checkApproval(
  tool: LocalTool,
  input: Record<string, unknown>,
): Promise<{ allow: boolean; reason?: string }> {
  const trust: TrustLevel = tool.trustLevel ?? 'safe'
  // Side-effect-free tools short-circuit allow regardless of mode; keeping
  // this branch first also narrows `trust` for the dispatch call below.
  if (trust === 'safe' || trust === 'sandboxed') return { allow: true }
  const mode = usePrefsStore.getState().permissionMode
  const modeDecision = trustDecision(mode, trust)
  if (modeDecision === 'auto') return { allow: true }
  if (modeDecision === 'deny') {
    return { allow: false, reason: readOnlyBlockedReason(tool.name) }
  }
  // modeDecision === 'ask'. Only proposal-first localWrite tools may skip
  // the pre-exec modal. For those tools, `execute()` builds a proposal and
  // the real mutation happens via an approval-card applier on Approve.
  //
  // Do NOT key this off `cardMode` alone: some `review` / `edit` tools do
  // real work during execute() and use the post-exec card only to review
  // what the agent sees next. Those must still ask before execute().
  // Host-exec tools also always hit the modal because they run shell /
  // Python during execute().
  if (trust !== 'hostExec' && isProposalFirstTool(tool.name)) {
    const card = resolveCardMode(tool)
    if (card === 'review' || card === 'edit') return { allow: true }
  }
  const dialog = useAgentDialogStore.getState()
  const decision = await dialog.requestApproval({
    toolName: tool.name,
    toolDescription: tool.description,
    trustLevel: trust,
    input,
  })
  if (decision.kind === 'deny') return { allow: false, reason: 'user_denied' }
  return { allow: true }
}

/**
 * Phase α / ε — Post-execution approval gate. Runs when the tool's
 * resolved {@link CardMode} is `'review'` or `'edit'`; dispatches an
 * `approval_required` WS event (so the UI flips the AgentCard into the
 * button / editor state), then blocks on the promise registered with
 * {@link registerPendingApproval}. The user's click in the card calls
 * `setStepApproval` in the session-store, which resolves this same
 * promise via `resolvePendingApproval`.
 *
 * Semantics per mode:
 *  - `'review'` the raw output passes through on approve; any
 *    `editedOutput` is ignored.
 *  - `'edit'`   the user's edited payload (if any) replaces the raw
 *    output; missing edits pass raw through (same as today's
 *    `'require'` flow).
 *
 * Returns either the output to feed the LLM, or `{ rejected: true }`
 * so the caller can synthesise the sentinel error the LLM is expected
 * to stop on.
 */
export async function awaitApprovalIfRequired(opts: {
  tool: LocalTool
  rawOutput: unknown
  taskId: string
  stepId: string
  sessionId: string
  toolName: string
  signal: AbortSignal
}): Promise<{ rejected: false; output: unknown } | { rejected: true }> {
  const { tool, rawOutput, taskId, stepId, sessionId, toolName, signal } = opts
  const mode = resolveCardMode(tool)
  if (mode !== 'review' && mode !== 'edit') {
    return { rejected: false, output: rawOutput }
  }

  // Auto-accept / YOLO short-circuit the approval wait: the user has
  // already said "trust the agent for this session", so dispatching
  // `approval_required` would just flash a card nobody will click.
  //
  // But: proposal-first tools (workspace_write_file, workspace_edit_file,
  // format_convert, latex_*) only touch disk / artifacts inside their
  // **applier**, which normally runs when the user clicks Approve. If we
  // merely return the raw proposal here, the LLM gets back "I wrote the
  // file" while disk stays untouched. So we mirror the UI's onApprove
  // path: invoke the applier right now, then return as approved.
  if (autoApprovesCard(usePrefsStore.getState().permissionMode)) {
    const applier = getToolApplier(toolName)
    if (applier) {
      try {
        applier(sessionId, rawOutput)
      } catch (err) {
        // Surface as a toast — orchestrator still treats this as
        // "approved" because the LLM's tool_result should reflect what
        // the tool computed; swallowing the error here also matches
        // what the UI's PendingActions.onApprove does on applier
        // failure (it already toasts and advances approval).
        toast.error(
          `Auto-apply failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
    return { rejected: false, output: rawOutput }
  }

  const waitPromise = registerPendingApproval(stepId)
  wsClient.dispatch('approval_required', {
    task_id: taskId,
    step_id: stepId,
    session_id: sessionId,
    tool_name: toolName,
    output_summary: summarizeToolOutput(rawOutput),
    output: rawOutput,
  })

  // Thread cooperative cancellation through the wait so an aborted turn
  // doesn't leak a pending approval forever. We race the approval promise
  // against an abort listener and throw so the outer catch folds the
  // error back into the loop's tool_result path.
  const resolution = await new Promise<{ state: string; editedOutput?: unknown }>(
    (resolve, reject) => {
      const onAbort = () => reject(new Error('Aborted'))
      if (signal.aborted) return onAbort()
      signal.addEventListener('abort', onAbort, { once: true })
      waitPromise
        .then((value) => {
          signal.removeEventListener('abort', onAbort)
          resolve(value)
        })
        .catch((err) => {
          signal.removeEventListener('abort', onAbort)
          reject(err)
        })
    },
  )

  if (resolution.state === 'rejected') return { rejected: true }
  // `review` ignores any `editedOutput` — the raw tool output is what
  // the LLM sees on approve. `edit` uses the edited payload when the
  // editor produced one; `undefined` means "approve as-is" and passes
  // the raw output through (otherwise the string `"undefined"` would
  // end up in the LLM's context).
  if (mode === 'review') return { rejected: false, output: rawOutput }
  return {
    rejected: false,
    output:
      resolution.editedOutput !== undefined ? resolution.editedOutput : rawOutput,
  }
}
