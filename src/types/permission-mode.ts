// Session-level permission-mode presets.
//
// Sits on top of the per-tool `trustLevel` / `cardMode` machinery. One
// dropdown in the chat header overrides the approval behavior for every
// tool call in the current session, so a user doing a batch file rewrite
// doesn't have to click Approve 20 times in a row.
//
// The matrix is intentionally small — four modes, each a single word.
// Per-tool overrides (`deny workspace_bash but allow workspace_write`)
// live in a follow-up Settings surface, not here.

import type { TrustLevel } from './agent-tool'

export type PermissionMode = 'normal' | 'auto-accept' | 'read-only' | 'yolo'

export const PERMISSION_MODES: readonly PermissionMode[] = [
  'normal',
  'auto-accept',
  'read-only',
  'yolo',
] as const

export const PERMISSION_MODE_LABEL: Record<PermissionMode, string> = {
  normal: 'Normal',
  'auto-accept': 'Auto-accept',
  'read-only': 'Read-only',
  yolo: 'YOLO',
}

/** Short tag for tight UI surfaces (status bar chip, closed picker). */
export const PERMISSION_MODE_SHORT: Record<PermissionMode, string> = {
  normal: 'Normal',
  'auto-accept': 'Auto',
  'read-only': 'R/O',
  yolo: 'YOLO',
}

export const PERMISSION_MODE_DESCRIPTION: Record<PermissionMode, string> = {
  normal: 'Ask before destructive tools. Review each card.',
  'auto-accept': 'Auto-approve proposal cards. Host exec still asks.',
  'read-only': 'Block any tool that writes to disk or runs a process.',
  yolo: 'Skip every prompt. Assume you trust the agent.',
}

/**
 * Per-tool trust decision given a mode + the tool's declared trust level.
 * The permission mode is the single source of truth for the pre-exec
 * gate — the orchestrator does NOT cross-check `prefs.agentApproval`
 * afterward (that field is legacy; permission modes subsume it).
 *
 *   `'auto'`  — allow without prompting
 *   `'ask'`   — show the host-exec approval modal before running
 *   `'deny'`  — orchestrator throws a blocked-error the LLM can recover from
 *
 * Matrix summary:
 *   Normal      — ask for localWrite + hostExec; user reviews every mutation
 *   Auto-accept — auto localWrite (pre-exec skipped, post-exec card also
 *                 auto-approved); hostExec still asks because shelling out
 *                 is too blast-radius-y to silently allow
 *   Read-only   — deny everything that isn't side-effect-free
 *   YOLO        — auto every gate
 */
export function trustDecision(
  mode: PermissionMode,
  trust: TrustLevel,
): 'auto' | 'ask' | 'deny' {
  // `safe` / `sandboxed` are side-effect-free by construction — every mode
  // should auto-allow them. Keeping this short-circuit at the top also
  // means read-only doesn't block e.g. `workspace_read_file`.
  if (trust === 'safe' || trust === 'sandboxed') return 'auto'
  switch (mode) {
    case 'read-only':
      return 'deny'
    case 'yolo':
      return 'auto'
    case 'auto-accept':
      // Host exec stays behind the modal even in auto-accept — running
      // arbitrary shell / python is one "rm -rf" away from disaster and
      // the user explicitly did NOT opt into YOLO.
      return trust === 'hostExec' ? 'ask' : 'auto'
    case 'normal':
      return 'ask'
  }
}

/**
 * Whether the mode auto-approves `cardMode: 'review' | 'edit'` cards.
 * Auto-accept + YOLO both short-circuit the post-exec approval wait so
 * proposal-first tools (workspace_write_file, workspace_edit_file,
 * format_convert, compute_create_script, latex-*, detect_peaks, …) go
 * straight to the applier without a user click.
 */
export function autoApprovesCard(mode: PermissionMode): boolean {
  return mode === 'auto-accept' || mode === 'yolo'
}

/** Human message for the `read_only_blocked` error the orchestrator
 *  feeds back to the LLM when a mutation tool is called under read-only.
 *  The LLM treats this like `plan_mode_blocked` — retries a read-only
 *  alternative or reports back. */
export function readOnlyBlockedReason(toolName: string): string {
  return `read_only_blocked: tool "${toolName}" cannot run while the session is in read-only mode. Ask the user to switch to Normal or suggest a non-mutating alternative.`
}
