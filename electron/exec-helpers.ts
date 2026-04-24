// Low-level non-streaming `spawn` wrappers shared between the compute
// runner (`compute-runner.ts`), the container lifecycle handlers
// (`ipc-compute-container.ts`), and the pip manager
// (`ipc-compute-pip.ts`). Previously each module carried its own
// copy-paste of this exact code — nearly 150 LOC duplicated, with
// subtle drift (one version was missing the try/catch around `spawn`,
// another skipped the `settled` guard inside `setTimeout`). Extracting
// picks the most defensive variant so all three callers share the same
// timeout + error semantics.
//
// These helpers are deliberately synchronous in spirit: no streaming,
// no stdout chunk emission. For long-running container builds or pip
// installs we use separate `runComposeStreaming` / `runStreaming`
// helpers that keep their own stdout/stderr piping logic — those are
// streaming-specific enough that sharing them wouldn't pay off.

import {
  spawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process'

export interface SimpleExecResult {
  code: number
  stdout: string
  stderr: string
}

/**
 * Spawn a process with no stdin, collect stdout + stderr, enforce a
 * timeout. Returns `code: -1` when the process fails to spawn, times
 * out, or emits an error before exit. Never rejects.
 */
export function execSimple(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<SimpleExecResult> {
  return new Promise((resolve) => {
    let settled = false
    let stdout = ''
    let stderr = ''
    let proc: ChildProcess
    try {
      proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      resolve({
        code: -1,
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
      })
      return
    }
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        proc.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      resolve({ code: -1, stdout, stderr: stderr || 'timeout' })
    }, timeoutMs)
    proc.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString('utf8')
    })
    proc.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString('utf8')
    })
    proc.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: err.message })
    })
    proc.on('exit', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}

/**
 * Same as `execSimple` but pipes a string into the child's stdin before
 * closing it. Used by pip operations that pass requirements.txt content
 * inline to `pip install -r -`.
 */
export function execPipe(
  cmd: string,
  args: string[],
  stdin: string,
  timeoutMs: number,
): Promise<SimpleExecResult> {
  return new Promise((resolve) => {
    let settled = false
    let stdout = ''
    let stderr = ''
    let proc: ChildProcessWithoutNullStreams
    try {
      proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      resolve({
        code: -1,
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
      })
      return
    }
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        proc.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      resolve({ code: -1, stdout, stderr: stderr || 'timeout' })
    }, timeoutMs)
    proc.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8')
    })
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8')
    })
    proc.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: err.message })
    })
    proc.on('exit', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr })
    })
    try {
      proc.stdin.write(stdin)
      proc.stdin.end()
    } catch {
      /* ignore */
    }
  })
}
