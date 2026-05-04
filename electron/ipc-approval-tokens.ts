// One-shot, scope-bound approval tokens for hostExec IPC channels.
//
// Flow:
//   1. Renderer calls `electronAPI.issueApprovalToken({ toolName, scope })`
//      after the React trust gate's ApprovalDialog accepts. The main process
//      shows its own native confirmation for hostExec, then mints a random
//      hex token bound to `(toolName, canonicalScope, expiresAt)` and returns
//      it.
//   2. Renderer immediately invokes the action's IPC channel (e.g.
//      `compute:run`, `workspace:bash`, `mcp:call-tool`,
//      `plugin:call-tool`) including `approvalToken: <minted>` in the
//      payload.
//   3. The action handler calls `consumeApprovalToken(token, toolName,
//      scope)` which validates and **single-uses** the token. Mismatched
//      tool name / scope / expired / unknown all return `{ ok: false,
//      error }`.
//
// The native main-process gate is what stops a compromised renderer from
// invoking hostExec without a user-visible confirmation; without a minted
// token the action IPC handler refuses.

import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { randomBytes } from 'node:crypto'

interface IssueRequest {
  toolName: unknown
  scope?: unknown
}

type IssueResponse =
  | { ok: true; token: string }
  | { ok: false; error: string }

interface PendingToken {
  toolName: string
  scopeKey: string
  expiresAt: number
}

/** How long a freshly-minted token stays valid before it expires. The
 *  renderer should call the host IPC immediately after issue, so a
 *  short window is fine and limits replay risk if the token leaks. */
const TOKEN_TTL_MS = 60_000

/** Sweep expired tokens out of the map on every issue/consume so the
 *  Map can't grow unboundedly even if a renderer mints tokens it
 *  never consumes. */
const pending = new Map<string, PendingToken>()
const HOST_EXEC_TOOLS = new Set([
  'compute_run',
  'mcp_call_tool',
  'plugin_call_tool',
  'workspace_bash',
])

function canonicalizeScope(scope: unknown): string {
  if (scope === null || scope === undefined) return ''
  if (typeof scope !== 'object') return JSON.stringify(scope)
  if (Array.isArray(scope)) return JSON.stringify(scope.map(canonicalSorted))
  return canonicalSorted(scope as Record<string, unknown>)
}

function canonicalSorted(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalSorted).join(',') + ']'
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + canonicalSorted(obj[k]))
      .join(',') +
    '}'
  )
}

function sweepExpired(now: number): void {
  for (const [token, entry] of pending) {
    if (entry.expiresAt <= now) pending.delete(token)
  }
}

function mintToken(
  toolName: string,
  scopeKey: string,
  now: number,
): string {
  // 32 bytes of entropy → 64 hex chars. Tokens never leave the local
  // machine but generous entropy is still cheap and rules out
  // accidental collision under heavy use.
  const token = randomBytes(32).toString('hex')
  pending.set(token, {
    toolName,
    scopeKey,
    expiresAt: now + TOKEN_TTL_MS,
  })
  return token
}

function truncatePreview(value: string, max = 4000): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n...`
}

async function confirmHostExec(
  event: IpcMainInvokeEvent,
  toolName: string,
  scope: unknown,
): Promise<boolean> {
  const parent = BrowserWindow.fromWebContents(event.sender)
  const detail = truncatePreview(JSON.stringify(scope ?? {}, null, 2))
  const result = parent
    ? await dialog.showMessageBox(parent, {
        type: 'warning',
        buttons: ['Deny', 'Allow once'],
        defaultId: 0,
        cancelId: 0,
        title: 'Approve host execution',
        message: `Allow Lattice to run ${toolName}?`,
        detail,
      })
    : await dialog.showMessageBox({
        type: 'warning',
        buttons: ['Deny', 'Allow once'],
        defaultId: 0,
        cancelId: 0,
        title: 'Approve host execution',
        message: `Allow Lattice to run ${toolName}?`,
        detail,
      })
  return result.response === 1
}

export interface ConsumeResult {
  ok: boolean
  error?: string
}

/**
 * Validate a token presented by the renderer. Returns ok only if the
 * token was minted, has not expired, has not been consumed, and matches
 * the action's tool name + canonical scope. The token is removed from
 * the pending map regardless of outcome on a name/scope mismatch (the
 * renderer is misbehaving — don't keep the token around for retry).
 */
export function consumeApprovalToken(
  token: unknown,
  toolName: string,
  scope: Record<string, unknown>,
): ConsumeResult {
  if (typeof token !== 'string' || token.length === 0) {
    return { ok: false, error: 'approval token is missing' }
  }
  const now = Date.now()
  sweepExpired(now)
  const entry = pending.get(token)
  if (!entry) {
    return { ok: false, error: 'approval token unknown or already consumed' }
  }
  if (entry.expiresAt <= now) {
    pending.delete(token)
    return { ok: false, error: 'approval token expired' }
  }
  if (entry.toolName !== toolName) {
    pending.delete(token)
    return {
      ok: false,
      error: `approval token issued for '${entry.toolName}', not '${toolName}'`,
    }
  }
  const scopeKey = canonicalizeScope(scope)
  if (entry.scopeKey !== scopeKey) {
    pending.delete(token)
    return { ok: false, error: 'approval token scope mismatch' }
  }
  pending.delete(token)
  return { ok: true }
}

/**
 * Register the renderer-facing IPC handler. Called once during main
 * boot from `electron/main.ts`.
 */
export function registerApprovalTokenIpc(): void {
  ipcMain.handle(
    'approval-token:issue',
    async (event, raw: unknown): Promise<IssueResponse> => {
      const req = (raw ?? {}) as IssueRequest
      const toolName = typeof req.toolName === 'string' ? req.toolName : ''
      if (!toolName) {
        return { ok: false, error: 'toolName is required' }
      }
      if (!HOST_EXEC_TOOLS.has(toolName)) {
        return {
          ok: false,
          error: `approval tokens are not available for '${toolName}'`,
        }
      }
      if (!(await confirmHostExec(event, toolName, req.scope))) {
        return { ok: false, error: 'user_denied' }
      }
      const now = Date.now()
      sweepExpired(now)
      const scopeKey = canonicalizeScope(req.scope)
      const token = mintToken(toolName, scopeKey, now)
      return { ok: true, token }
    },
  )
}
