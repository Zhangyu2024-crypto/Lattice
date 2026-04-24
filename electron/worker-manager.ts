// Lifecycle + JSON-RPC bridge for the repo-local Python worker.
//
// One long-lived `python3 -u worker/main.py` per Electron session. The
// process is lazy-spawned on the first `call()` so an installation
// without Python doesn't pay any cost until a worker-backed feature is
// actually invoked. Health reporting bubbles up to the renderer via
// `worker:event` IPC messages so the StatusBar / Settings panel can
// surface "running / unavailable / starting" to the user.
//
// Self-contained Port Plan §P4-α — see worker/README.md for the
// protocol and `docs/PYTHON_WORKER_PLAN.md` for the long-term plan.

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BrowserWindow } from 'electron'
import { resolvePython, buildCondaSpawnEnv } from './conda-env-manager'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Resolve the `worker/` directory across dev + packaged builds.
 *
 * In dev, `__dirname` is `<repo>/dist-electron/`; `..` → `<repo>/` which
 * contains `worker/main.py`. In a packaged build (`electron-builder.yml`
 * ships `worker/` via `extraResources`), the tree is mirrored under
 * `process.resourcesPath/worker/`. Try the packaged location first; fall
 * back to the repo-relative path. If neither exists callers see a
 * structured `failed` state from the spawn error — no silent mis-boot. */
function resolveWorkerRoot(): string {
  const packed = process.resourcesPath
    ? path.join(process.resourcesPath, 'worker')
    : null
  if (packed && fs.existsSync(packed)) return packed
  return path.resolve(__dirname, '..', 'worker')
}

export type WorkerStatus =
  | { state: 'idle' }
  | { state: 'starting' }
  | {
      state: 'ready'
      tools: string[]
      pythonVersion: string
      protocol: string
    }
  | { state: 'failed'; error: string }

export interface WorkerCallRequest {
  method: string
  params?: Record<string, unknown>
  /** Optional per-call timeout. Default 30s — long-running scientific
   *  routines will need their own callsite override. */
  timeoutMs?: number
}

export type WorkerCallResult =
  | { success: true; result: unknown; durationMs: number }
  | { success: false; error: string; durationMs: number; code?: string }

interface PendingCall {
  resolve: (value: WorkerCallResult) => void
  startedAt: number
  timer: NodeJS.Timeout
}

const READY_TIMEOUT_MS = 8_000
const DEFAULT_CALL_TIMEOUT_MS = 30_000

export class WorkerManager extends EventEmitter {
  private process: ChildProcessWithoutNullStreams | null = null
  private status: WorkerStatus = { state: 'idle' }
  private pending = new Map<string, PendingCall>()
  /** Stdout chunks that don't end in a newline yet. Drained on every
   *  `\n` encountered. */
  private stdoutBuffer = ''
  private nextRequestSeq = 0
  /** `start()` is idempotent — repeat calls share the same underlying
   *  promise so two concurrent `call()` invocations don't both spawn. */
  private startPromise: Promise<void> | null = null
  /** Caller-supplied window getter so we can push events to the
   *  renderer without dragging the BrowserWindow into the constructor. */
  private getWindow: () => BrowserWindow | null

  constructor(getWindow: () => BrowserWindow | null) {
    super()
    this.getWindow = getWindow
  }

  getStatus(): WorkerStatus {
    return this.status
  }

  /** Spawn the worker if we haven't already, then resolve once the
   *  initial `ready` event arrives. Idempotent + concurrency-safe. */
  async start(): Promise<void> {
    if (this.status.state === 'ready') return
    if (this.startPromise) return this.startPromise

    this.startPromise = this.doStart().finally(() => {
      // Allow another start attempt on next call if this one failed.
      if (this.status.state !== 'ready') this.startPromise = null
    })
    return this.startPromise
  }

  /** Send a JSON-RPC call and resolve with the worker's response.
   *  Auto-starts the worker if it isn't running yet. */
  async call(req: WorkerCallRequest): Promise<WorkerCallResult> {
    try {
      await this.start()
    } catch (err) {
      return {
        success: false,
        error: this.errorMessage(err, 'failed to start worker'),
        durationMs: 0,
      }
    }
    if (!this.process || this.process.killed) {
      return {
        success: false,
        error: 'Worker not running',
        durationMs: 0,
      }
    }
    const id = `r${++this.nextRequestSeq}`
    const timeoutMs = req.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS
    const startedAt = Date.now()

    return new Promise<WorkerCallResult>((resolve) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(id)
        if (!pending) return
        this.pending.delete(id)
        pending.resolve({
          success: false,
          error: `Worker call timed out after ${timeoutMs}ms`,
          durationMs: Date.now() - pending.startedAt,
        })
      }, timeoutMs)
      this.pending.set(id, { resolve, startedAt, timer })
      const line = JSON.stringify({
        id,
        method: req.method,
        params: req.params ?? {},
      })
      try {
        this.process!.stdin.write(`${line}\n`)
      } catch (err) {
        const pending = this.pending.get(id)
        if (!pending) return
        clearTimeout(pending.timer)
        this.pending.delete(id)
        pending.resolve({
          success: false,
          error: this.errorMessage(err, 'stdin write failed'),
          durationMs: Date.now() - pending.startedAt,
        })
      }
    })
  }

  /** Ask the worker to round-trip a small payload — used by health
   *  checks + the "Test Python worker" command palette entry. */
  async health(): Promise<WorkerCallResult> {
    return this.call({ method: 'system.echo', params: { ping: 'health' } })
  }

  async stop(): Promise<void> {
    if (!this.process) return
    try {
      this.process.stdin.end()
    } catch {
      // ignore
    }
    const proc = this.process
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (!proc.killed) proc.kill('SIGKILL')
        resolve()
      }, 3000)
      proc.once('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
      proc.kill('SIGTERM')
    })
    this.process = null
    this.startPromise = null
    this.setStatus({ state: 'idle' })
  }

  private async doStart(): Promise<void> {
    if (this.process && !this.process.killed) return
    this.setStatus({ state: 'starting' })

    const python = process.env.LATTICE_WORKER_PYTHON || resolvePython()
    const workerScript = path.join(resolveWorkerRoot(), 'main.py')

    let proc: ChildProcessWithoutNullStreams
    try {
      proc = spawn(python, ['-u', workerScript], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: buildCondaSpawnEnv({
          PYTHONUNBUFFERED: '1',
        }),
      })
    } catch (err) {
      const msg = this.errorMessage(err, 'failed to spawn python')
      this.setStatus({ state: 'failed', error: msg })
      throw new Error(msg)
    }

    this.process = proc
    proc.stdout.setEncoding('utf8')
    proc.stderr.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => this.handleStdout(chunk))
    proc.stderr.on('data', (chunk: string) => {
      // Surface unstructured worker noise in the main-process log so a
      // user `--inspect` session can see it; don't bubble per-line to
      // the renderer (would be too chatty).
      // eslint-disable-next-line no-console
      console.warn(`[worker stderr] ${chunk.trimEnd()}`)
    })
    proc.on('exit', (code, signal) => this.handleExit(code, signal))
    proc.on('error', (err) => {
      const msg = this.errorMessage(err, 'worker process error')
      this.setStatus({ state: 'failed', error: msg })
      this.rejectAllPending(msg)
    })

    // Block on the worker's `ready` event so the first `.call()` after
    // `.start()` is guaranteed to find the dispatcher running.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const msg = `Worker did not signal ready within ${READY_TIMEOUT_MS}ms`
        this.setStatus({ state: 'failed', error: msg })
        reject(new Error(msg))
      }, READY_TIMEOUT_MS)
      const onReady = () => {
        clearTimeout(timer)
        resolve()
      }
      const onFail = (err: Error) => {
        clearTimeout(timer)
        reject(err)
      }
      this.once('ready', onReady)
      this.once('fail', onFail)
    })
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    let newlineIndex = this.stdoutBuffer.indexOf('\n')
    while (newlineIndex >= 0) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1)
      if (line.length > 0) this.handleLine(line)
      newlineIndex = this.stdoutBuffer.indexOf('\n')
    }
  }

  private handleLine(line: string): void {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(line) as Record<string, unknown>
    } catch {
      // eslint-disable-next-line no-console
      console.warn(`[worker] non-JSON line: ${line}`)
      return
    }

    if (typeof parsed.event === 'string') {
      this.handleEvent(parsed)
      return
    }

    const id = parsed.id
    if (typeof id !== 'string') return
    const pending = this.pending.get(id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(id)
    const durationMs =
      typeof parsed.duration_ms === 'number'
        ? parsed.duration_ms
        : Date.now() - pending.startedAt
    if ('error' in parsed) {
      const errorObj = parsed.error as { message?: string; code?: string }
      pending.resolve({
        success: false,
        error: errorObj?.message ?? 'Unknown worker error',
        code: errorObj?.code,
        durationMs,
      })
      return
    }
    pending.resolve({
      success: true,
      result: parsed.result,
      durationMs,
    })
  }

  private handleEvent(payload: Record<string, unknown>): void {
    const event = payload.event as string
    if (event === 'ready') {
      const tools = Array.isArray(payload.tools)
        ? (payload.tools as string[])
        : []
      const pythonVersion =
        typeof payload.python === 'string' ? payload.python : 'unknown'
      const protocol =
        typeof payload.protocol === 'string' ? payload.protocol : '?'
      this.setStatus({
        state: 'ready',
        tools,
        pythonVersion,
        protocol,
      })
      this.emit('ready')
      return
    }
    if (event === 'log') {
      const level = typeof payload.level === 'string' ? payload.level : 'info'
      const message =
        typeof payload.message === 'string' ? payload.message : ''
      // eslint-disable-next-line no-console
      console.log(`[worker:${level}] ${message}`)
      // Also forward so the renderer's global error-capture can pipe the
      // line into the structured log store with source: 'worker'.
      this.broadcastEvent(payload)
      return
    }
    // Forward progress / unknown events to the renderer so subscribers
    // (e.g. agent orchestrator running a long XRD search) can react.
    this.broadcastEvent(payload)
  }

  private broadcastEvent(payload: Record<string, unknown>): void {
    const win = this.getWindow()
    if (!win || win.isDestroyed()) return
    win.webContents.send('worker:event', payload)
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.process = null
    const message = `Worker exited (code=${code ?? 'null'} signal=${signal ?? 'null'})`
    this.rejectAllPending(message)
    if (this.status.state !== 'failed') {
      this.setStatus({
        state: code === 0 ? 'idle' : 'failed',
        ...(code === 0 ? {} : { error: message }),
      } as WorkerStatus)
    }
    this.emit('fail', new Error(message))
  }

  private rejectAllPending(reason: string): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.resolve({
        success: false,
        error: reason,
        durationMs: Date.now() - pending.startedAt,
      })
    }
    this.pending.clear()
  }

  private setStatus(next: WorkerStatus): void {
    this.status = next
    const win = this.getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('worker:status', next)
    }
  }

  private errorMessage(err: unknown, fallback: string): string {
    if (err instanceof Error) return `${fallback}: ${err.message}`
    if (typeof err === 'string' && err.length > 0) return `${fallback}: ${err}`
    return fallback
  }
}
