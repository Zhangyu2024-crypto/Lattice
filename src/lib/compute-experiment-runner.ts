// Renderer-side driver for compute-experiment artifacts (parameter
// sweeps).
//
// Reuses the existing single-script compute IPC (`electronAPI.computeRun`
// + the stdout/stderr/exit streams) one point at a time. The original
// design likely supported parallel dispatch — this implementation is
// deliberately sequential, which keeps the runtime state simple and is
// the right default for a workstation app where most users do not want
// N concurrent CP2K runs starving each other.
//
// Per-point script rendering replaces `{{params_json}}` /
// `{{point_id}}` / `{{point_index}}` / `{{param:<name>}}` placeholders
// in `payload.pointScriptTemplate` before each run.
//
// Point metrics are parsed from sentinel lines printed to stdout:
//
//   __LATTICE_METRIC__ name=value
//   __LATTICE_METRIC__ name=value unit=kJ/mol
//
// Multiple sentinels per run are accepted; later values overwrite
// earlier ones with the same name.

import { useRuntimeStore } from '../stores/runtime-store'
import { useComputeConfigStore } from '../stores/compute-config-store'
import type {
  ComputeExperimentPayload,
  ComputeExperimentPoint,
  ComputeExperimentPointStatus,
  ComputeExperimentStatus,
} from '../types/artifact'
import type {
  ComputeExitEventPayload,
  ComputeRunRequestPayload,
  ComputeStreamChunkPayload,
} from '../types/electron'

const MAX_TIMEOUT_SEC = 24 * 60 * 60

interface ActiveExperiment {
  artifactId: string
  sessionId: string
  /** Set while a point is running so cancel knows what to abort. */
  currentRunId: string | null
  cancelRequested: boolean
}

const activeByArtifact = new Map<string, ActiveExperiment>()

interface RunArgs {
  sessionId: string
  artifactId: string
  /** Which subset of points to run.
   *  - `pending` — only points with status==='pending'
   *  - `failed`  — only points with status==='failed'
   *  - `all`     — every point regardless of status (re-runs succeeded
   *                ones too; rare, but the agent surface allows it). */
  mode: 'pending' | 'failed' | 'all'
}

export function isComputeExperimentActive(artifactId: string): boolean {
  return activeByArtifact.has(artifactId)
}

export async function runComputeExperiment(args: RunArgs): Promise<void> {
  const electron = window.electronAPI
  if (!electron?.computeRun) {
    throw new Error('Compute IPC not available — restart the app')
  }
  if (activeByArtifact.has(args.artifactId)) {
    throw new Error('A compute experiment is already in flight for this artifact')
  }

  const config = useComputeConfigStore.getState()
  if (config.mode === 'disabled') {
    throw new Error(
      'Compute is disabled. Switch to Native in Settings → Compute Environment.',
    )
  }

  const payload = readPayload(args.sessionId, args.artifactId)
  if (!payload) throw new Error('Compute-experiment artifact not found')
  if (!payload.pointScriptTemplate || !payload.pointScriptTemplate.trim()) {
    throw new Error(
      'Experiment has no pointScriptTemplate. Set one before running points.',
    )
  }

  const targetIds = selectPointIds(payload.points, args.mode)
  if (targetIds.length === 0) {
    throw new Error(
      `No points match mode='${args.mode}' — nothing to run.`,
    )
  }

  const active: ActiveExperiment = {
    artifactId: args.artifactId,
    sessionId: args.sessionId,
    currentRunId: null,
    cancelRequested: false,
  }
  activeByArtifact.set(args.artifactId, active)

  patchPayload(args.sessionId, args.artifactId, (p) => ({
    ...p,
    status: 'running' as ComputeExperimentStatus,
    progress: { current: 0, total: targetIds.length },
    stdout: '',
    stderr: '',
    activeRunId: null,
    points: p.points.map((pt) =>
      targetIds.includes(pt.id)
        ? {
            ...pt,
            status: 'queued' as ComputeExperimentPointStatus,
            error: undefined,
            exitCode: undefined,
            durationMs: undefined,
            startedAt: undefined,
            endedAt: undefined,
            metrics: undefined,
          }
        : pt,
    ),
  }))

  try {
    let processed = 0
    for (const pointId of targetIds) {
      if (active.cancelRequested) break
      const fresh = readPayload(args.sessionId, args.artifactId)
      if (!fresh) break
      const point = fresh.points.find((pt) => pt.id === pointId)
      if (!point) continue
      processed += 1
      await runOnePoint({
        sessionId: args.sessionId,
        artifactId: args.artifactId,
        point,
        payload: fresh,
        active,
        progress: { current: processed, total: targetIds.length },
      })
    }
  } finally {
    finaliseStatus(args.sessionId, args.artifactId, active.cancelRequested)
    activeByArtifact.delete(args.artifactId)
  }
}

export async function cancelComputeExperiment(
  _sessionId: string,
  artifactId: string,
): Promise<boolean> {
  const active = activeByArtifact.get(artifactId)
  if (!active) return false
  active.cancelRequested = true
  const electron = window.electronAPI
  if (active.currentRunId && electron?.computeCancel) {
    try {
      await electron.computeCancel(active.currentRunId)
    } catch {
      /* ignore — cancel is best-effort */
    }
  }
  return true
}

// ─── Internals ────────────────────────────────────────────────────────

interface RunPointArgs {
  sessionId: string
  artifactId: string
  point: ComputeExperimentPoint
  payload: ComputeExperimentPayload
  active: ActiveExperiment
  progress: { current: number; total: number }
}

async function runOnePoint(args: RunPointArgs): Promise<void> {
  const electron = window.electronAPI
  if (!electron?.computeRun || !electron?.issueApprovalToken) return

  const code = renderTemplate(
    args.payload.pointScriptTemplate ?? '',
    args.point,
  )
  const language = args.payload.engine
  const config = useComputeConfigStore.getState()
  const runId = genRunId()
  const startedAt = Date.now()

  args.active.currentRunId = runId
  patchPayload(args.sessionId, args.artifactId, (p) => ({
    ...p,
    activeRunId: runId,
    progress: args.progress,
    points: p.points.map((pt) =>
      pt.id === args.point.id
        ? {
            ...pt,
            status: 'running' as ComputeExperimentPointStatus,
            runId,
            startedAt,
          }
        : pt,
    ),
  }))

  let stdout = ''
  let stderr = ''
  const unsubs: Array<() => void> = []
  const exitEvent = await new Promise<ComputeExitEventPayload>((resolve) => {
    unsubs.push(
      electron.onComputeStdout((msg: ComputeStreamChunkPayload) => {
        if (msg.runId !== runId) return
        stdout += msg.chunk
      }),
    )
    unsubs.push(
      electron.onComputeStderr((msg: ComputeStreamChunkPayload) => {
        if (msg.runId !== runId) return
        stderr += msg.chunk
      }),
    )
    unsubs.push(
      electron.onComputeExit((msg: ComputeExitEventPayload) => {
        if (msg.runId !== runId) return
        resolve(msg)
      }),
    )
    void dispatchRun({
      runId,
      code,
      language,
      mode: config.mode,
      timeoutSec: normaliseTimeoutSec(config.timeoutSec),
      resources: {
        cpuCores: config.resources.cpuCores,
        ompThreads: config.resources.ompThreads,
      },
      sessionId: args.sessionId,
      artifactId: args.artifactId,
    }).catch((err: unknown) => {
      // Synthesize an exit event so the awaiter resolves.
      resolve({
        runId,
        exitCode: -1,
        durationMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
        timedOut: false,
        cancelled: false,
        figures: [],
      })
    })
  })

  for (const off of unsubs) {
    try {
      off()
    } catch {
      /* ignore */
    }
  }
  args.active.currentRunId = null

  const endedAt = Date.now()
  const status: ComputeExperimentPointStatus = exitEvent.cancelled
    ? 'cancelled'
    : exitEvent.timedOut || exitEvent.exitCode !== 0 || exitEvent.error
    ? 'failed'
    : 'succeeded'
  const metrics = parseMetrics(stdout)

  patchPayload(args.sessionId, args.artifactId, (p) => ({
    ...p,
    activeRunId: null,
    stdout: appendBlock(p.stdout, args.point, stdout),
    stderr: stderr
      ? appendBlock(p.stderr, args.point, stderr)
      : p.stderr,
    points: p.points.map((pt) =>
      pt.id === args.point.id
        ? {
            ...pt,
            status,
            runId,
            startedAt,
            endedAt,
            exitCode: exitEvent.exitCode,
            durationMs: exitEvent.durationMs,
            error:
              exitEvent.error ??
              (exitEvent.timedOut
                ? 'timed out'
                : status === 'failed'
                ? `exit ${exitEvent.exitCode}`
                : undefined),
            metrics: Object.keys(metrics).length > 0 ? metrics : pt.metrics,
          }
        : pt,
    ),
  }))
}

async function dispatchRun(
  request: ComputeRunRequestPayload,
): Promise<void> {
  const electron = window.electronAPI
  if (!electron?.computeRun || !electron?.issueApprovalToken) {
    throw new Error('Compute IPC not available')
  }
  const issued = await electron.issueApprovalToken({
    toolName: 'compute_run',
    scope: {
      runId: request.runId,
      code: request.code,
      language: request.language ?? '',
      mode: request.mode,
    },
  })
  if (!issued.ok) throw new Error(issued.error)
  const ack = await electron.computeRun({
    ...request,
    approvalToken: issued.token,
  })
  if (!ack.success) throw new Error(ack.error)
}

function selectPointIds(
  points: ComputeExperimentPoint[],
  mode: RunArgs['mode'],
): string[] {
  if (mode === 'all') return points.map((p) => p.id)
  if (mode === 'failed') return points.filter((p) => p.status === 'failed').map((p) => p.id)
  return points.filter((p) => p.status === 'pending').map((p) => p.id)
}

const PARAM_RE = /\{\{param:([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g
const SIMPLE_PLACEHOLDERS = ['params_json', 'point_id', 'point_index'] as const

function renderTemplate(
  template: string,
  point: ComputeExperimentPoint,
): string {
  let out = template.replace(PARAM_RE, (_match, name: string) => {
    const v = point.params[name]
    return v === undefined ? '' : String(v)
  })
  for (const ph of SIMPLE_PLACEHOLDERS) {
    const re = new RegExp(`\\{\\{${ph}\\}\\}`, 'g')
    if (ph === 'params_json') out = out.replace(re, JSON.stringify(point.params))
    else if (ph === 'point_id') out = out.replace(re, point.id)
    else if (ph === 'point_index') out = out.replace(re, String(point.index))
  }
  return out
}

const METRIC_RE = /^__LATTICE_METRIC__\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(\S+)/gm

function parseMetrics(stdout: string): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {}
  METRIC_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = METRIC_RE.exec(stdout)) !== null) {
    const key = m[1]
    const raw = m[2]
    const num = Number(raw)
    if (Number.isFinite(num) && raw.trim() !== '') {
      out[key] = num
    } else if (raw === 'true' || raw === 'false') {
      out[key] = raw === 'true'
    } else {
      out[key] = raw
    }
  }
  return out
}

function appendBlock(
  prev: string,
  point: ComputeExperimentPoint,
  chunk: string,
): string {
  if (!chunk.trim()) return prev
  const header = `\n— ${point.id} (idx=${point.index}) —\n`
  return (prev ?? '') + header + chunk
}

function finaliseStatus(
  sessionId: string,
  artifactId: string,
  cancelled: boolean,
): void {
  patchPayload(sessionId, artifactId, (p) => {
    const failed = p.points.filter((pt) => pt.status === 'failed').length
    const succeeded = p.points.filter((pt) => pt.status === 'succeeded').length
    const pending = p.points.filter((pt) => pt.status === 'pending' || pt.status === 'queued' || pt.status === 'running').length
    let status: ComputeExperimentStatus
    if (cancelled) status = 'cancelled'
    else if (pending > 0) status = 'partial'
    else if (failed === 0) status = 'succeeded'
    else if (succeeded === 0) status = 'failed'
    else status = 'partial'
    // Any run that didn't finish (cancel mid-flight, or runner threw) is
    // left in 'running' / 'queued' on the point. Demote to a clear final
    // state so the UI doesn't show a permanent spinner.
    const points = p.points.map((pt) =>
      pt.status === 'running' || pt.status === 'queued'
        ? { ...pt, status: cancelled ? 'cancelled' as const : 'pending' as const }
        : pt,
    )
    return { ...p, status, points, activeRunId: null, progress: undefined }
  })
}

function readPayload(
  sessionId: string,
  artifactId: string,
): ComputeExperimentPayload | null {
  const session = useRuntimeStore.getState().sessions[sessionId]
  const artifact = session?.artifacts[artifactId]
  if (!artifact || artifact.kind !== 'compute-experiment') return null
  return artifact.payload as ComputeExperimentPayload
}

function patchPayload(
  sessionId: string,
  artifactId: string,
  mutate: (p: ComputeExperimentPayload) => ComputeExperimentPayload,
): void {
  const current = readPayload(sessionId, artifactId)
  if (!current) return
  const next = mutate(current)
  useRuntimeStore.getState().patchArtifact(sessionId, artifactId, {
    payload: next,
  } as never)
}

function genRunId(): string {
  return `expt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

function normaliseTimeoutSec(value: number): number {
  return Math.min(MAX_TIMEOUT_SEC, Math.max(1, Math.ceil(value)))
}
