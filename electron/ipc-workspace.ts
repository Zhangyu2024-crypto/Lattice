// IPC for `workspace_bash` — the main-chat agent's shell runner.
//
// The tool layer (`src/lib/agent-tools/workspace-bash.ts`) is trust-
// level 'hostExec', so every invocation is pre-gated by the user-facing
// ApprovalDialog; by the time a request reaches this handler, the user
// has already confirmed the command + cwd. We therefore accept any
// `workspaceDir` the caller supplies — typically `useWorkspaceStore()
// .rootPath`, but legitimately anything the user approved.
//
// Streaming protocol matches the original coding-subagent version:
// `workspace:bash-chunk` events fire out-of-band when an `invocationId`
// is supplied; the final Promise still resolves with the full stdout /
// stderr for LLM consumption.

import { spawn } from 'child_process'
import { ipcMain } from 'electron'

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
      if (!req || typeof req !== 'object') {
        return { success: false, error: 'invalid request' }
      }
      const r = req as {
        workspaceDir?: unknown
        command?: unknown
        timeoutMs?: unknown
        invocationId?: unknown
      }
      if (typeof r.workspaceDir !== 'string' || typeof r.command !== 'string') {
        return { success: false, error: 'workspaceDir and command required' }
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
          resolve({ success: false, error: err.message, stdout, stderr })
        })
        child.on('close', (code) => {
          if (resolved) return
          resolved = true
          clearTimers()
          flushCompleteLines()
          flushPartial()
          sendDone(timedOut ? 'timeout' : 'ok', code)
          resolve({
            success: code === 0,
            exitCode: code,
            stdout: stdout.slice(-MAX_BASH_OUTPUT_BYTES),
            stderr: stderr.slice(-MAX_BASH_OUTPUT_BYTES),
          })
        })
      })
    },
  )
}
