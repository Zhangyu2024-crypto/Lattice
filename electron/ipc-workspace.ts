// IPC for `workspace_bash` — the main-chat agent's shell runner.
//
// The renderer-side tool layer prompts before host execution, but the
// main process still enforces a one-shot approval token so direct IPC calls
// cannot bypass the orchestrator approval gate accidentally.
//
// Streaming protocol matches the original coding-subagent version:
// `workspace:bash-chunk` events fire out-of-band when an `invocationId`
// is supplied; the final Promise still resolves with the full stdout /
// stderr for LLM consumption.

import { spawn } from 'child_process'
import { ipcMain } from 'electron'
import { consumeApprovalToken } from './ipc-approval-tokens'
import { recordApiCall } from './api-call-audit'

const MAX_BASH_OUTPUT_BYTES = 4 * 1024 * 1024
const DEFAULT_BASH_TIMEOUT_MS = 120_000
/** Max delay between a chunk arriving from the child and being sent to the
 *  renderer. Coalescing short bursts into 50 ms windows avoids flooding IPC
 *  when a command emits many small writes (e.g. `pytest -v`). */
const BASH_CHUNK_FLUSH_MS = 50

export function registerWorkspaceIpc(): void {
  ipcMain.handle(
    'workspace:bash',
    async (event, req: unknown) => {
      const startedAt = Date.now()
      if (!req || typeof req !== 'object') {
        const result = { success: false, error: 'invalid request' }
        recordApiCall({
          kind: 'workspace.bash',
          source: 'workspace',
          operation: 'workspace:bash',
          status: 'error',
          durationMs: Date.now() - startedAt,
          request: { validPayload: false },
          response: result,
          error: result.error,
        })
        return result
      }
      const r = req as {
        workspaceDir?: unknown
        command?: unknown
        timeoutMs?: unknown
        invocationId?: unknown
        approvalToken?: unknown
      }
      if (typeof r.workspaceDir !== 'string' || typeof r.command !== 'string') {
        const result = { success: false, error: 'workspaceDir and command required' }
        recordApiCall({
          kind: 'workspace.bash',
          source: 'workspace',
          operation: 'workspace:bash',
          status: 'error',
          durationMs: Date.now() - startedAt,
          request: {
            workspaceDir: typeof r.workspaceDir === 'string' ? r.workspaceDir : undefined,
            command: typeof r.command === 'string' ? r.command : undefined,
          },
          response: result,
          error: result.error,
        })
        return result
      }
      const tokenCheck = consumeApprovalToken(r.approvalToken, 'workspace_bash', {
        workspaceDir: r.workspaceDir,
        command: r.command,
      })
      if (!tokenCheck.ok) {
        const result = { success: false, error: tokenCheck.error }
        recordApiCall({
          kind: 'workspace.bash',
          source: 'workspace',
          operation: 'workspace:bash',
          status: 'error',
          durationMs: Date.now() - startedAt,
          workspaceRoot: r.workspaceDir,
          request: { workspaceDir: r.workspaceDir, command: r.command },
          response: result,
          error: result.error,
        })
        return result
      }
      const timeoutMs =
        typeof r.timeoutMs === 'number' && Number.isFinite(r.timeoutMs)
          ? Math.min(Math.max(1_000, Math.floor(r.timeoutMs)), 600_000)
          : DEFAULT_BASH_TIMEOUT_MS
      const invocationId =
        typeof r.invocationId === 'string' && r.invocationId.length > 0
          ? r.invocationId
          : null

      return await new Promise((resolve) => {
        const webContents = event.sender
        let stdout = ''
        let stderr = ''
        const residual = { stdout: '', stderr: '' }
        let flushTimer: NodeJS.Timeout | null = null
        let resolved = false
        let timedOut = false

        const sendChunk = (stream: 'stdout' | 'stderr', data: string): void => {
          if (!invocationId || !data) return
          if (webContents.isDestroyed()) return
          webContents.send('workspace:bash-chunk', {
            invocationId,
            stream,
            data,
          })
        }

        const sendDone = (
          status: 'ok' | 'error' | 'timeout',
          exitCode: number | null,
        ): void => {
          if (!invocationId) return
          if (webContents.isDestroyed()) return
          webContents.send('workspace:bash-done', {
            invocationId,
            status,
            exitCode,
          })
        }

        const flushCompleteLines = (): void => {
          for (const stream of ['stdout', 'stderr'] as const) {
            const buf = residual[stream]
            const lastNl = buf.lastIndexOf('\n')
            if (lastNl < 0) continue
            sendChunk(stream, buf.slice(0, lastNl + 1))
            residual[stream] = buf.slice(lastNl + 1)
          }
        }

        const flushPartial = (): void => {
          if (residual.stdout) {
            sendChunk('stdout', residual.stdout)
            residual.stdout = ''
          }
          if (residual.stderr) {
            sendChunk('stderr', residual.stderr)
            residual.stderr = ''
          }
        }

        const scheduleFlush = (): void => {
          if (!invocationId || flushTimer) return
          flushTimer = setTimeout(() => {
            flushTimer = null
            flushCompleteLines()
          }, BASH_CHUNK_FLUSH_MS)
        }

        const child = spawn(r.command as string, {
          cwd: r.workspaceDir as string,
          shell: true,
        })

        const killTimer = setTimeout(() => {
          if (resolved) return
          timedOut = true
          try {
            child.kill('SIGTERM')
          } catch {
            // already gone
          }
          setTimeout(() => {
            try {
              child.kill('SIGKILL')
            } catch {
              // noop
            }
          }, 3_000)
        }, timeoutMs)

        const clearTimers = (): void => {
          clearTimeout(killTimer)
          if (flushTimer) {
            clearTimeout(flushTimer)
            flushTimer = null
          }
        }

        child.stdout?.on('data', (chunk: Buffer) => {
          const text = chunk.toString('utf-8')
          if (stdout.length < MAX_BASH_OUTPUT_BYTES) stdout += text
          residual.stdout += text
          scheduleFlush()
        })
        child.stderr?.on('data', (chunk: Buffer) => {
          const text = chunk.toString('utf-8')
          if (stderr.length < MAX_BASH_OUTPUT_BYTES) stderr += text
          residual.stderr += text
          scheduleFlush()
        })
        child.on('error', (err) => {
          if (resolved) return
          resolved = true
          clearTimers()
          flushCompleteLines()
          flushPartial()
          sendDone('error', null)
          const result = { success: false, error: err.message, stdout, stderr }
          recordApiCall({
            kind: 'workspace.bash',
            source: 'workspace',
            operation: 'workspace:bash',
            status: 'error',
            durationMs: Date.now() - startedAt,
            workspaceRoot: r.workspaceDir as string,
            request: {
              workspaceDir: r.workspaceDir,
              command: r.command,
              timeoutMs,
              invocationId,
            },
            response: {
              success: false,
              stdoutBytes: Buffer.byteLength(stdout, 'utf8'),
              stderrBytes: Buffer.byteLength(stderr, 'utf8'),
            },
            error: err.message,
          })
          resolve(result)
        })
        child.on('close', (code) => {
          if (resolved) return
          resolved = true
          clearTimers()
          flushCompleteLines()
          flushPartial()
          sendDone(timedOut ? 'timeout' : 'ok', code)
          const result = {
            success: code === 0,
            exitCode: code,
            stdout: stdout.slice(-MAX_BASH_OUTPUT_BYTES),
            stderr: stderr.slice(-MAX_BASH_OUTPUT_BYTES),
          }
          recordApiCall({
            kind: 'workspace.bash',
            source: 'workspace',
            operation: 'workspace:bash',
            status: timedOut ? 'cancelled' : code === 0 ? 'ok' : 'error',
            durationMs: Date.now() - startedAt,
            workspaceRoot: r.workspaceDir as string,
            request: {
              workspaceDir: r.workspaceDir,
              command: r.command,
              timeoutMs,
              invocationId,
            },
            response: {
              success: result.success,
              exitCode: code,
              timedOut,
              stdoutBytes: Buffer.byteLength(stdout, 'utf8'),
              stderrBytes: Buffer.byteLength(stderr, 'utf8'),
            },
            error: code === 0 ? undefined : stderr || stdout,
          })
          resolve(result)
        })
      })
    },
  )
}
