/**
 * Phase η — approval-gate smoke test (pure node, no DOM).
 *
 * Exercises the promise bridge that connects the AgentCard's Approve /
 * Reject buttons (which flow through `setStepApproval` in the session
 * store) to the orchestrator's `awaitApprovalIfRequired` wait loop.
 *
 * The bridge is `registerPendingApproval` / `resolvePendingApproval`
 * in `agent-orchestrator-approvals.ts` — two functions plus one module-
 * local map. This script drives that surface directly, since the full
 * orchestrator loop needs the LLM proxy (Electron IPC) which isn't
 * available under plain node.
 *
 * Run:
 *   npx tsx src/__smoke__/approval-gate-smoke.ts
 *
 * Exit codes: 0 = all checks passed; 1 = at least one check failed.
 *
 * Manual end-to-end test steps (no node smoke available in-app):
 *   1. `npm run electron:dev`, open a session, run a tool whose
 *      `cardMode === 'edit'` (e.g. `detect_peaks`).
 *   2. Card should render with Approve / Reject buttons and the
 *      detect-peaks editor.
 *   3. Edit a peak row, click Approve — the orchestrator should log
 *      that it received `editedOutput` and the next LLM turn sees the
 *      edited payload (inspect via the `tool_result` message).
 *   4. Reject path — click Reject; orchestrator should short-circuit
 *      with a `user_rejected` tool_result.
 */

import {
  clearPendingApprovals,
  registerPendingApproval,
  resolvePendingApproval,
} from '../lib/agent-orchestrator-approvals'

type Check = { name: string; ok: boolean; detail?: string }
const checks: Check[] = []

function record(name: string, ok: boolean, detail?: string): void {
  checks.push({ name, ok, detail })
  const mark = ok ? 'PASS' : 'FAIL'
  const suffix = detail ? ` — ${detail}` : ''
  // eslint-disable-next-line no-console
  console.log(`[approval-gate] ${mark} ${name}${suffix}`)
}

async function approveAsIs(): Promise<void> {
  const stepId = 'step_0_0_tu_approve_asis'
  const wait = registerPendingApproval(stepId)
  const matched = resolvePendingApproval(stepId, { state: 'approved' })
  record('approve-as-is: resolver reports a hit', matched)
  const res = await wait
  record(
    'approve-as-is: promise resolves with state=approved',
    res.state === 'approved' && res.editedOutput === undefined,
    `got ${JSON.stringify(res)}`,
  )
}

async function approveWithEdit(): Promise<void> {
  const stepId = 'step_0_1_tu_approve_edit'
  const wait = registerPendingApproval(stepId)
  const edited = { peaks: [{ position: 42, intensity: 3 }] }
  resolvePendingApproval(stepId, { state: 'approved', editedOutput: edited })
  const res = await wait
  record(
    'approve-with-edit: promise carries editedOutput through',
    res.state === 'approved' &&
      JSON.stringify(res.editedOutput) === JSON.stringify(edited),
    `got ${JSON.stringify(res)}`,
  )
}

async function rejection(): Promise<void> {
  const stepId = 'step_0_2_tu_reject'
  const wait = registerPendingApproval(stepId)
  resolvePendingApproval(stepId, { state: 'rejected' })
  const res = await wait
  record(
    'reject: promise resolves with state=rejected',
    res.state === 'rejected',
    `got ${JSON.stringify(res)}`,
  )
}

async function unknownIdIsNoop(): Promise<void> {
  const matched = resolvePendingApproval('not_a_real_step', { state: 'approved' })
  record(
    'unknown step id: resolver returns false',
    matched === false,
    `matched=${matched}`,
  )
}

async function clearUnwindsWaits(): Promise<void> {
  const stepId = 'step_0_3_tu_orphan'
  const wait = registerPendingApproval(stepId)
  clearPendingApprovals()
  const res = await wait
  record(
    'clearPendingApprovals: orphaned waits resolve as rejected',
    res.state === 'rejected',
    `got ${JSON.stringify(res)}`,
  )
}

async function main(): Promise<void> {
  await approveAsIs()
  await approveWithEdit()
  await rejection()
  await unknownIdIsNoop()
  await clearUnwindsWaits()

  const failed = checks.filter((c) => !c.ok)
  // eslint-disable-next-line no-console
  console.log(
    `\n[approval-gate] ${checks.length - failed.length}/${checks.length} passed`,
  )
  if (failed.length > 0) {
    process.exitCode = 1
  }
}

void main()
