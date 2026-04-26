// `LocalProCompute` — drop-in replacement for the 6 `pro.compute*` methods
// used by `ComputeProWorkbench`. Routes through Electron IPC to the
// Native compute runner (bundled conda env) plus a static snippet catalog
// and userData script storage.
//
// Python / LAMMPS / CP2K all route through the same runner; session
// context (ACTIVE_CIFS / CURRENT_SPECTRUM / WORKDIR) is injected as env
// vars on the spawned process.
//
// Why a separate facade rather than patching `useProApi`:
//   - keeps the rest of `pro.*` (xrd / xps / raman) untouched
//   - reads ComputeConfigStore at call time (no React coupling)
//   - lets the workbench keep its synchronous `pro.computeXxx(...)` shape

import { useComputeConfigStore } from '../stores/compute-config-store'
import {
  selectActiveSession,
  useRuntimeStore,
} from '../stores/runtime-store'
import { getComputeSnippets } from './compute-snippets-catalog'
import type {
  ComputeExecRequest,
  ComputeExecResponse,
  ComputeHealthResponse,
  ComputeLanguage,
  ComputeSnippetsResponse,
  ListScriptsResponse,
  LoadScriptResponse,
  SaveScriptRequest,
  SaveScriptResponse,
} from '../types/pro-api'
import type {
  ComputeExitEventPayload,
  ComputeRunContextPayload,
  ComputeRunRequestPayload,
} from '../types/electron'

const IPC_UNAVAILABLE =
  'Compute IPC unavailable — restart the desktop app.'

function genRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Pre-flight check against `ComputeConfigStore`. Returns a human-readable
 * reason when a run can't start, or `null` when the config is valid.
 */
function configError(): string | null {
  const config = useComputeConfigStore.getState()
  if (config.mode === 'disabled') {
    return 'Compute is disabled in Settings → Compute Environment.'
  }
  return null
}

function failure(
  error: string,
  stdout = '',
  stderr = '',
): ComputeExecResponse {
  return {
    success: false,
    error,
    stdout,
    stderr,
    exit_code: null,
    timed_out: false,
    duration_ms: 0,
    figures: [],
  }
}

function buildExitResponse(
  msg: ComputeExitEventPayload,
  stdout: string,
  stderr: string,
): ComputeExecResponse {
  const cancelled = msg.cancelled
  const success = !cancelled && msg.exitCode === 0 && !msg.error
  const error =
    msg.error ??
    (cancelled
      ? 'Execution timed out'
      : msg.exitCode === 0
        ? undefined
        : `Process exited with code ${msg.exitCode ?? 'unknown'}`)
  return {
    success,
    error,
    stdout,
    stderr,
    exit_code: msg.exitCode,
    timed_out: cancelled,
    duration_ms: msg.durationMs,
    figures: msg.figures.map((f) => ({
      format: f.format,
      base64: f.base64,
      caption: f.caption,
    })),
  }
}

/**
 * Collect session context to send down as env vars.
 *
 *  - `CURRENT_SPECTRUM`: the first spectrum artifact's data in the
 *    active session (single-focus mirror of lattice-cli's global).
 *  - `ACTIVE_CIFS`: dict keyed by a short id (artifact id or cell id
 *    or slugified title), value = `{ cif_text, formula, source, spaceGroup }`.
 *    Sourced from:
 *      1. Every `StructureArtifact` in the active session
 *      2. Every Compute-notebook structure cell's `lastRun.stdout`
 *         that parses as a CIF (built but not yet promoted to an artifact)
 *    This is what unblocks `next(iter(ACTIVE_CIFS.values()))` in
 *    user scripts — the dict is empty before any structure exists in
 *    the session, not because the wiring is missing.
 */
function buildRunContext(): ComputeRunContextPayload {
  const session = selectActiveSession(useRuntimeStore.getState())
  const context: ComputeRunContextPayload = {
    activeCifs: {},
    currentSpectrum: null,
    workdir: '/tmp',
  }
  if (!session) return context

  const activeCifs: Record<string, unknown> = {}

  for (const id of session.artifactOrder) {
    const artifact = session.artifacts[id]
    if (!artifact) continue
    if (artifact.kind === 'spectrum' && context.currentSpectrum == null) {
      const payload = artifact.payload as {
        x?: number[]
        y?: number[]
        xLabel?: string
        yLabel?: string
        spectrumType?: string
      }
      if (Array.isArray(payload.x) && Array.isArray(payload.y)) {
        context.currentSpectrum = {
          x: payload.x,
          y: payload.y,
          xLabel: payload.xLabel,
          yLabel: payload.yLabel,
          type: payload.spectrumType,
        }
      }
    } else if (artifact.kind === 'structure') {
      const payload = artifact.payload as {
        cif?: string
        formula?: string
        spaceGroup?: string
      }
      if (typeof payload.cif === 'string' && payload.cif.length > 0) {
        const key = slugForCifKey(artifact.title || payload.formula || artifact.id)
        activeCifs[key] = {
          cif_text: payload.cif,
          formula: payload.formula,
          space_group: payload.spaceGroup,
          source: 'structure-artifact',
          artifact_id: artifact.id,
        }
      }
    } else if (artifact.kind === 'compute-pro') {
      // A compute-pro workbench may have built structures inside its cells
      // that haven't been promoted to standalone artifacts yet. Scan each
      // structure cell's lastRun.stdout — if it looks like a CIF (starts
      // with `data_` after trimming), expose it keyed by cell id so user
      // scripts can do `load_structure('cell_xxx')`.
      const payload = artifact.payload as {
        cells?: Array<{
          id: string
          kind?: string
          code?: string
          lastRun?: { stdout?: string } | null
        }>
      }
      for (const cell of payload.cells ?? []) {
        if (cell.kind !== 'structure-ai' && cell.kind !== 'structure-code') continue
        const stdout = cell.lastRun?.stdout
        if (!stdout || !looksLikeCif(stdout)) continue
        activeCifs[cell.id] = {
          cif_text: stdout,
          source: 'compute-cell',
          cell_id: cell.id,
          compute_artifact_id: artifact.id,
        }
      }
    }
  }

  context.activeCifs = activeCifs
  return context
}

/** Slug an arbitrary label for use as an ACTIVE_CIFS dict key — lower-case,
 *  spaces / punctuation collapsed to `_`, trimmed to 48 chars. Exported
 *  because the Structure → Simulate templates must use the exact same
 *  slug so `load_structure('<slug>')` in the spawned cell hits the dict
 *  entry that `buildRunContext` just injected. */
export function slugForCifKey(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
  return slug || 'structure'
}

/** Cheap CIF-sniff: a parseable CIF always starts with a `data_` block. */
function looksLikeCif(text: string): boolean {
  const head = text.slice(0, 200).trim()
  return head.startsWith('data_')
}

export const localProCompute = {
  async computeSnippets(
    language?: ComputeLanguage,
  ): Promise<ComputeSnippetsResponse> {
    return { snippets: getComputeSnippets(language) }
  },

  async computeHealth(): Promise<ComputeHealthResponse> {
    const config = useComputeConfigStore.getState()
    const invalid = configError()
    if (invalid) {
      return {
        container_up: false,
        python_version: null,
        packages: undefined,
        error: invalid,
        lammps_available: undefined,
        cp2k_available: undefined,
      }
    }
    const electron = window.electronAPI
    if (!electron?.computeTestConnection) {
      return {
        container_up: false,
        python_version: null,
        packages: undefined,
        error: IPC_UNAVAILABLE,
        lammps_available: undefined,
        cp2k_available: undefined,
      }
    }
    try {
      const result = await electron.computeTestConnection({
        mode: config.mode,
      })
      return {
        container_up: result.container_up,
        python_version: result.python_version ?? null,
        packages: result.packages,
        error: result.error ?? null,
        lammps_available: result.lammps_available,
        cp2k_available: result.cp2k_available,
      }
    } catch (err) {
      return {
        container_up: false,
        python_version: null,
        packages: undefined,
        error: errorMessage(err),
        lammps_available: undefined,
        cp2k_available: undefined,
      }
    }
  },

  async computeExec(req: ComputeExecRequest): Promise<ComputeExecResponse> {
    const language = (req.language ?? 'python') as ComputeLanguage
    if (!['python', 'lammps', 'cp2k'].includes(language)) {
      return failure(`Unsupported language: ${language}`)
    }

    const invalid = configError()
    if (invalid) return failure(invalid)

    const electron = window.electronAPI
    if (
      !electron?.computeRun ||
      !electron.onComputeStdout ||
      !electron.onComputeStderr ||
      !electron.onComputeExit
    ) {
      return failure(IPC_UNAVAILABLE)
    }

    const config = useComputeConfigStore.getState()
    const runId = genRunId()
    const ipcReq: ComputeRunRequestPayload = {
      runId,
      code: req.code,
      language,
      mode: config.mode,
      timeoutSec:
        typeof req.timeout_s === 'number' ? req.timeout_s : config.timeoutSec,
      context: buildRunContext(),
    }

    return await new Promise<ComputeExecResponse>((resolve) => {
      let stdout = ''
      let stderr = ''
      let settled = false

      // Must close over the unsubscribers *after* we get them back from
      // `onCompute*`; we initialise to no-ops so the finish() path is safe
      // even if `onCompute*` throws or returns undefined somehow.
      let unsubStdout = () => {}
      let unsubStderr = () => {}
      let unsubExit = () => {}

      const finish = (response: ComputeExecResponse): void => {
        if (settled) return
        settled = true
        try {
          unsubStdout()
        } catch {
          // ignore
        }
        try {
          unsubStderr()
        } catch {
          // ignore
        }
        try {
          unsubExit()
        } catch {
          // ignore
        }
        resolve(response)
      }

      unsubStdout = electron.onComputeStdout((msg) => {
        if (msg.runId !== runId) return
        stdout += msg.chunk
      })
      unsubStderr = electron.onComputeStderr((msg) => {
        if (msg.runId !== runId) return
        stderr += msg.chunk
      })
      unsubExit = electron.onComputeExit((msg) => {
        if (msg.runId !== runId) return
        finish(buildExitResponse(msg, stdout, stderr))
      })

      void electron
        .issueApprovalToken({
          toolName: 'compute_run',
          scope: {
            runId: ipcReq.runId,
            code: ipcReq.code,
            language: ipcReq.language ?? '',
            mode: ipcReq.mode,
          },
        })
        .then((issued) => {
          if (!issued.ok) throw new Error(issued.error)
          return electron.computeRun({
            ...ipcReq,
            approvalToken: issued.token,
          })
        })
        .then((ack) => {
          if (!ack.success) finish(failure(ack.error, stdout, stderr))
        })
        .catch((err) => {
          finish(failure(errorMessage(err), stdout, stderr))
        })
    })
  },

  async computeSaveScript(req: SaveScriptRequest): Promise<SaveScriptResponse> {
    const electron = window.electronAPI
    if (!electron?.computeScriptsSave) {
      return { success: false, error: IPC_UNAVAILABLE }
    }
    try {
      const result = await electron.computeScriptsSave(req)
      return result.success
        ? { success: true, name: result.name, path: result.path }
        : { success: false, error: result.error }
    } catch (err) {
      return { success: false, error: errorMessage(err) }
    }
  },

  async computeListScripts(): Promise<ListScriptsResponse> {
    const electron = window.electronAPI
    if (!electron?.computeScriptsList) {
      throw new Error(IPC_UNAVAILABLE)
    }
    return await electron.computeScriptsList()
  },

  async computeLoadScript(name: string): Promise<LoadScriptResponse> {
    const electron = window.electronAPI
    if (!electron?.computeScriptsLoad) {
      throw new Error(IPC_UNAVAILABLE)
    }
    const result = await electron.computeScriptsLoad(name)
    if (!result.success) {
      throw new Error(result.error)
    }
    return {
      name: result.name,
      filename: result.filename,
      code: result.code,
    }
  },
}
