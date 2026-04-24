// `workspace_bash` — run shell commands inside the user's workspace root.
//
// cwd = `useWorkspaceStore().rootPath`. The caller can still reach outside
// the root with well-crafted commands (absolute paths, `cd ..`, etc.),
// but the hostExec trust gate's ApprovalDialog fires BEFORE every
// invocation, so the user sees the full command string and can refuse.
//
// When the orchestrator supplies `ctx.reportProgress`, each line-buffered
// chunk of stdout/stderr is forwarded out-of-band (still line-level, 50 ms
// throttled in the main process). The tool's final return value is
// unchanged — the streamed chunks are additive for UI, not for the LLM.

import type { LocalTool } from '../../types/agent-tool'
import { useWorkspaceStore } from '../../stores/workspace-store'

interface Input {
  command: string
  timeoutMs?: number
}

interface Output {
  success: boolean
  exitCode: number
  stdout: string
  stderr: string
}

function genInvocationId(): string {
  return `ws-bash-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`
}

export const workspaceBashTool: LocalTool<Input, Output> = {
  name: 'workspace_bash',
  description:
    'Run a shell command in the user workspace root (cwd = workspace root). Returns stdout, stderr, exit code. Default timeout 120s, max 600s. Output capped at 4 MB. hostExec trust → the user is prompted before every run.',
  trustLevel: 'hostExec',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Shell command (e.g. "python script.py", "ls -la").',
      },
      timeoutMs: {
        type: 'number',
        description: 'Max run time in milliseconds. Default 120000.',
      },
    },
    required: ['command'],
  },
  async execute(input, ctx) {
    const workspaceDir = useWorkspaceStore.getState().rootPath
    if (!workspaceDir) {
      throw new Error(
        'No workspace root configured. Set it in Settings → Workspace.',
      )
    }
    if (!window.electronAPI) {
      throw new Error('workspace_bash requires the Electron shell')
    }
    if (!input?.command?.trim()) throw new Error('command is required')

    const invocationId = ctx.reportProgress ? genInvocationId() : undefined
    const unsubscribers: Array<() => void> = []

    if (ctx.reportProgress && invocationId) {
      // Filter by invocationId because the preload uses one ipcRenderer
      // channel per event type — every concurrent bash call shares the
      // same listener list.
      unsubscribers.push(
        window.electronAPI.onWorkspaceBashChunk((msg) => {
          if (msg.invocationId !== invocationId) return
          ctx.reportProgress?.({
            kind: 'bash-output',
            stream: msg.stream,
            data: msg.data,
          })
        }),
      )
      unsubscribers.push(
        window.electronAPI.onWorkspaceBashDone((msg) => {
          if (msg.invocationId !== invocationId) return
          // Cleanup on the done signal too — the `finally` below is a
          // safety net for the non-streaming or main-crash paths.
          for (const off of unsubscribers.splice(0)) off()
        }),
      )
    }

    try {
      const res = await window.electronAPI.workspaceBash({
        workspaceDir,
        command: input.command,
        timeoutMs: input.timeoutMs,
        invocationId,
      })
      if (!res.success) {
        return {
          success: false,
          exitCode: typeof res.exitCode === 'number' ? res.exitCode : -1,
          stdout: res.stdout ?? '',
          stderr: res.stderr ?? res.error ?? 'bash failed',
        }
      }
      return {
        success: true,
        exitCode: res.exitCode,
        stdout: res.stdout,
        stderr: res.stderr,
      }
    } finally {
      for (const off of unsubscribers.splice(0)) off()
    }
  },
}
