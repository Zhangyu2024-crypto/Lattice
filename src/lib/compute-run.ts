// Renderer-side orchestrator for the Compute Run button.
//
// Bridges the ComputeArtifactCard's button handlers to the Electron IPC
// streams coming out of `electron/compute-runner.ts`. Responsibilities:
//   1. Read current compute config + validate
//   2. Generate a runId, pre-patch the artifact to `status: running` and
//      clear stdout/stderr/figures from the previous run
//   3. Subscribe to stdout / stderr / exit streams filtered by runId
//   4. Throttle stdout accumulation into `patchArtifact` via requestAnimationFrame
//   5. On exit, write the final payload (with figures) and tear down listeners
//   6. Allow cancellation by runId
//
// One run per artifact at a time: a second click of Run while a run is
// in flight is rejected via toast so we don't confuse the streaming state.

import { useRuntimeStore } from '../stores/runtime-store'
import { useComputeConfigStore } from '../stores/compute-config-store'
import { toast } from '../stores/toast-store'
import type {
  ComputeArtifactPayload,
  ComputeFigure,
} from '../types/artifact'
import type {
  ComputeExitEventPayload,
  ComputeRunRequestPayload,
  ComputeStreamChunkPayload,
} from '../types/electron'

interface ActiveRun {
  runId: string
  artifactId: string
  sessionId: string
  stdout: string
  stderr: string
  unsubStdout: () => void
  unsubStderr: () => void
  unsubExit: () => void
  rafScheduled: boolean
}

const activeByArtifact = new Map<string, ActiveRun>()
const activeByRun = new Map<string, ActiveRun>()

function genRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/** True if this artifact currently has a run in flight. */
export function isComputeRunActive(artifactId: string): boolean {
  return activeByArtifact.has(artifactId)
}

export async function runCompute(args: {
  sessionId: string
  artifactId: string
  code: string
}): Promise<{ success: boolean; error?: string }> {
  const electron = window.electronAPI
  if (!electron?.computeRun) {
    return { success: false, error: 'Compute IPC not available — restart the app' }
  }
  if (activeByArtifact.has(args.artifactId)) {
    return { success: false, error: 'A run is already in flight for this artifact' }
  }

  const config = useComputeConfigStore.getState()
  if (config.mode === 'disabled') {
    return {
      success: false,
      error:
        'Compute is disabled. Switch to Native in Settings → Compute Environment.',
    }
  }

  const runId = genRunId()
  const sessionStore = useRuntimeStore.getState()

  // Resolve the artifact's language for the IPC request.
  const session = sessionStore.sessions[args.sessionId]
  const artifact = session?.artifacts[args.artifactId]
  const artifactLanguage =
    (artifact?.payload as { language?: string } | undefined)?.language ?? 'python'

  // Pre-patch: mark artifact as running and clear previous results.
  sessionStore.patchArtifact(args.sessionId, args.artifactId, {
    payload: mergePayload(args.sessionId, args.artifactId, {
      stdout: '',
      stderr: '',
      figures: [],
      exitCode: null,
      status: 'running',
      durationMs: undefined,
      runId,
      image: 'native',
    }),
  } as never)

  const active: ActiveRun = {
    runId,
    artifactId: args.artifactId,
    sessionId: args.sessionId,
    stdout: '',
    stderr: '',
    unsubStdout: () => {},
    unsubStderr: () => {},
    unsubExit: () => {},
    rafScheduled: false,
  }
  activeByArtifact.set(args.artifactId, active)
  activeByRun.set(runId, active)

  const onStdout = (msg: ComputeStreamChunkPayload) => {
    if (msg.runId !== runId) return
    active.stdout += msg.chunk
    scheduleFlush(active)
  }
  const onStderr = (msg: ComputeStreamChunkPayload) => {
    if (msg.runId !== runId) return
    active.stderr += msg.chunk
    scheduleFlush(active)
  }
  const onExit = (msg: ComputeExitEventPayload) => {
    if (msg.runId !== runId) return
    finalizeRun(active, msg)
  }

  active.unsubStdout = electron.onComputeStdout(onStdout)
  active.unsubStderr = electron.onComputeStderr(onStderr)
  active.unsubExit = electron.onComputeExit(onExit)

  const request: ComputeRunRequestPayload = {
    runId,
    code: args.code,
    language: (artifactLanguage as ComputeRunRequestPayload['language']) ?? 'python',
    mode: config.mode,
    timeoutSec: config.timeoutSec,
    resources: {
      cpuCores: config.resources.cpuCores,
      ompThreads: config.resources.ompThreads,
    },
  }

  const ack = await electron.computeRun(request)
  if (!ack.success) {
    tearDown(active)
    activeByArtifact.delete(args.artifactId)
    activeByRun.delete(runId)
    sessionStore.patchArtifact(args.sessionId, args.artifactId, {
      payload: mergePayload(args.sessionId, args.artifactId, {
        status: 'failed',
        stderr: ack.error,
        runId: null,
        durationMs: 0,
        exitCode: null,
      }),
    } as never)
    return { success: false, error: ack.error }
  }
  return { success: true }
}

export async function cancelCompute(artifactId: string): Promise<boolean> {
  const active = activeByArtifact.get(artifactId)
  if (!active) return false
  const electron = window.electronAPI
  if (!electron?.computeCancel) return false
  try {
    await electron.computeCancel(active.runId)
    return true
  } catch {
    return false
  }
}

// ─── Internals ────────────────────────────────────────────────────────

function scheduleFlush(active: ActiveRun): void {
  if (active.rafScheduled) return
  active.rafScheduled = true
  window.requestAnimationFrame(() => {
    active.rafScheduled = false
    const sessionStore = useRuntimeStore.getState()
    sessionStore.patchArtifact(active.sessionId, active.artifactId, {
      payload: mergePayload(active.sessionId, active.artifactId, {
        stdout: active.stdout,
        stderr: active.stderr,
      }),
    } as never)
  })
}

function finalizeRun(active: ActiveRun, msg: ComputeExitEventPayload): void {
  const sessionStore = useRuntimeStore.getState()
  const status: ComputeArtifactPayload['status'] = msg.cancelled
    ? 'cancelled'
    : msg.exitCode === 0 && !msg.error
    ? 'succeeded'
    : 'failed'
  const stderrWithError = msg.error
    ? active.stderr + (active.stderr ? '\n' : '') + `[runtime error] ${msg.error}`
    : active.stderr
  const figures: ComputeFigure[] = msg.figures.map((f) => ({
    format: f.format,
    base64: f.base64,
    caption: f.caption,
  }))
  sessionStore.patchArtifact(active.sessionId, active.artifactId, {
    payload: mergePayload(active.sessionId, active.artifactId, {
      stdout: active.stdout,
      stderr: stderrWithError,
      figures,
      exitCode: msg.exitCode,
      status,
      durationMs: msg.durationMs,
      runId: null,
    }),
  } as never)
  tearDown(active)
  activeByArtifact.delete(active.artifactId)
  activeByRun.delete(active.runId)

  if (status === 'succeeded') {
    toast.success(`Compute finished in ${formatMs(msg.durationMs)}`)
  } else if (status === 'cancelled') {
    toast.info('Compute cancelled')
  } else {
    const hint = deriveFailureHint(stderrWithError)
    toast.error(`Compute failed${hint ? `: ${hint}` : ''}`, {
      source: 'compute',
      type: 'runtime',
      detail: {
        stderr: stderrWithError.slice(-2000),
        durationMs: msg.durationMs,
      },
    })
  }
}

function tearDown(active: ActiveRun): void {
  try {
    active.unsubStdout()
  } catch {
    /* ignore */
  }
  try {
    active.unsubStderr()
  } catch {
    /* ignore */
  }
  try {
    active.unsubExit()
  } catch {
    /* ignore */
  }
}

function mergePayload(
  sessionId: string,
  artifactId: string,
  patch: Partial<ComputeArtifactPayload>,
): ComputeArtifactPayload {
  const session = useRuntimeStore.getState().sessions[sessionId]
  const artifact = session?.artifacts[artifactId]
  const current = (artifact?.payload ?? {}) as ComputeArtifactPayload
  return { ...current, ...patch }
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
}

function deriveFailureHint(stderr: string): string {
  const moduleMiss = /ModuleNotFoundError: No module named ['"](\w+)['"]/.exec(stderr)
  if (moduleMiss) {
    return `missing '${moduleMiss[1]}' — the bundled conda env should include it; rebuild the env to restore`
  }
  return ''
}
