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
  ComputeRunEntry,
} from '../types/artifact'

const RUN_HISTORY_LIMIT = 20
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

  // Prepend a fresh history entry so the UI can show "running…" in the
  // history list from the moment Run is clicked. `finalizeRun` upgrades
  // this entry in-place with exit info + the archived workdir path.
  const startedAt = new Date().toISOString()
  const pendingEntry: ComputeRunEntry = {
    runId,
    startedAt,
    status: 'running',
  }

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
      runs: prependRunEntry(args.sessionId, args.artifactId, pendingEntry),
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
    // Identifiers so the main-process runner archives this execution
    // under `<userData>/workspace/compute/<sid>/<aid>/run_.../` and
    // includes the absolute workdir path in the exit event.
    sessionId: args.sessionId,
    artifactId: args.artifactId,
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
      runs: updateRunEntry(active.sessionId, active.artifactId, active.runId, {
        status,
        finishedAt: new Date().toISOString(),
        exitCode: msg.exitCode,
        cancelled: msg.cancelled,
        durationMs: msg.durationMs,
        ...(msg.workdir ? { workdir: msg.workdir } : {}),
      }),
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

/** Prepend a history entry, trimming to RUN_HISTORY_LIMIT. Caller is
 *  responsible for writing the returned array back via patchArtifact. */
function prependRunEntry(
  sessionId: string,
  artifactId: string,
  entry: ComputeRunEntry,
): ComputeRunEntry[] {
  const current = mergePayload(sessionId, artifactId, {}).runs ?? []
  return [entry, ...current].slice(0, RUN_HISTORY_LIMIT)
}

/** Merge exit-time fields onto the pending entry matched by runId (or
 *  append a new one if somehow absent). Preserves ordering of the rest
 *  of the array. */
function updateRunEntry(
  sessionId: string,
  artifactId: string,
  runId: string,
  patch: Partial<ComputeRunEntry>,
): ComputeRunEntry[] {
  const current = mergePayload(sessionId, artifactId, {}).runs ?? []
  const idx = current.findIndex((e) => e.runId === runId)
  if (idx < 0) {
    const fallback: ComputeRunEntry = {
      runId,
      startedAt: new Date().toISOString(),
      status: 'idle',
      ...patch,
    }
    return [fallback, ...current].slice(0, RUN_HISTORY_LIMIT)
  }
  const next = current.slice()
  next[idx] = { ...next[idx], ...patch }
  return next
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
