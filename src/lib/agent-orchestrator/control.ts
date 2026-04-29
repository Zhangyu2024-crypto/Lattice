// Iteration steering for the agent loop.
//
// `runAgentTurn` calls these once per iteration with the current
// progress counters. They decide whether to:
//   - Inject a "wrap up soon" nudge into the messages array (so the
//     model can adjust before the cap), and
//   - Force the next turn to be a tool-less final answer (so the loop
//     terminates cleanly instead of hitting the absolute ceiling).
//
// Keep this file lightweight and pure — both helpers are called once
// per iteration on the hot path.

import type { LlmMessagePayload } from '../../types/electron'

export interface IterationControlInput {
  iteration: number
  maxIterations: number
  toolStepCount: number
}

/** Iterations remaining when we start nudging the model toward a
 *  final answer. Two iterations gives the model one chance to react
 *  to the nudge before the no-tools turn fires. */
const NUDGE_BEFORE_CAP = 2

/** Iterations remaining when we drop tools entirely. The model gets
 *  one final tool-less turn to deliver an answer. */
const FORCE_FINAL_BEFORE_CAP = 1

/** Tool-call count beyond which we start nudging even if the iteration
 *  cap is far away. Heavy fan-out usually means the model is gathering
 *  context — past this point it should start synthesising. */
const SOFT_TOOL_STEP_NUDGE = 24

export function shouldForceFinalAnswer(args: IterationControlInput): boolean {
  const { iteration, maxIterations } = args
  if (maxIterations <= 0) return false
  return iteration >= maxIterations - FORCE_FINAL_BEFORE_CAP
}

export function buildIterationControlMessage(
  args: IterationControlInput,
): LlmMessagePayload | null {
  const { iteration, maxIterations, toolStepCount } = args
  if (maxIterations <= 0) return null

  if (iteration >= maxIterations - FORCE_FINAL_BEFORE_CAP) {
    return userNudge(
      `[control] You have reached the final iteration of this turn (${iteration + 1}/${maxIterations}). No tools are available now — reply with a final answer that summarises what you have already gathered.`,
    )
  }

  const remaining = maxIterations - iteration
  if (remaining <= NUDGE_BEFORE_CAP) {
    return userNudge(
      `[control] You have ${remaining} iteration${remaining === 1 ? '' : 's'} left in this turn (used ${toolStepCount} tool call${toolStepCount === 1 ? '' : 's'}). Stop gathering and start synthesising a final answer.`,
    )
  }

  if (toolStepCount >= SOFT_TOOL_STEP_NUDGE) {
    return userNudge(
      `[control] You have already made ${toolStepCount} tool calls this turn. Make sure each new call is necessary and start consolidating findings into a final answer soon.`,
    )
  }

  return null
}

function userNudge(text: string): LlmMessagePayload {
  return { role: 'user', content: text }
}
