import { consumeApprovalToken } from './ipc-approval-tokens'
import fs from 'node:fs'
import path from 'node:path'
import { ipcMain, shell, type BrowserWindow } from 'electron'
import {
  ComputeRunnerManager,
  computeArchiveRoots,
  type ComputeLanguage,
  type ComputeMode,
  type ComputeRunContext,
  type ComputeRunRequest,
  type ComputeTestRequest,
} from './compute-runner'

const MODES = new Set<ComputeMode>(['native', 'disabled'])
const LANGUAGES = new Set<ComputeLanguage>(['python', 'lammps', 'cp2k'])

function asContext(v: unknown): ComputeRunContext | undefined {
  if (!v || typeof v !== 'object') return undefined
  const c = v as Record<string, unknown>
  const ctx: ComputeRunContext = {}
  if (c.activeCifs && typeof c.activeCifs === 'object' && !Array.isArray(c.activeCifs)) {
    ctx.activeCifs = c.activeCifs as Record<string, unknown>
  }
  if (c.currentSpectrum && typeof c.currentSpectrum === 'object' && !Array.isArray(c.currentSpectrum)) {
    ctx.currentSpectrum = c.currentSpectrum as Record<string, unknown>
  } else if (c.currentSpectrum === null) {
    ctx.currentSpectrum = null
  }
  if (typeof c.workdir === 'string') {
    ctx.workdir = c.workdir
  }
  return ctx
}

function asResources(
  v: unknown,
): ComputeRunRequest['resources'] | undefined {
  if (!v || typeof v !== 'object') return undefined
  const r = v as Record<string, unknown>
  const out: NonNullable<ComputeRunRequest['resources']> = {}
  if (typeof r.cpuCores === 'number' && Number.isFinite(r.cpuCores)) {
    out.cpuCores = r.cpuCores
  }
  if (r.ompThreads === 'auto' || (typeof r.ompThreads === 'number' && Number.isFinite(r.ompThreads))) {
    out.ompThreads = r.ompThreads as number | 'auto'
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function isValidRunRequest(v: unknown): v is ComputeRunRequest {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  if (typeof r.runId !== 'string' || !r.runId) return false
  if (typeof r.code !== 'string') return false
  if (typeof r.mode !== 'string' || !MODES.has(r.mode as ComputeMode)) return false
  if (typeof r.timeoutSec !== 'number' || !Number.isFinite(r.timeoutSec)) return false
  if (r.language !== undefined) {
    if (typeof r.language !== 'string' || !LANGUAGES.has(r.language as ComputeLanguage)) return false
  }
  return true
}

function isValidTestRequest(v: unknown): v is ComputeTestRequest {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  if (typeof r.mode !== 'string' || !MODES.has(r.mode as ComputeMode)) {
    return false
  }
  return true
}

let manager: ComputeRunnerManager | null = null

export function registerComputeIpc(getWindow: () => BrowserWindow | null): ComputeRunnerManager {
  if (manager) return manager
  manager = new ComputeRunnerManager(getWindow)

  ipcMain.handle('compute:run', async (_event, req: unknown) => {
    if (!isValidRunRequest(req)) {
      return { success: false, error: 'Invalid compute:run payload' }
    }
    const raw = req as ComputeRunRequest & {
      context?: unknown
      resources?: unknown
      approvalToken?: unknown
    }
    const tokenCheck = consumeApprovalToken(raw.approvalToken, 'compute_run', {
      runId: raw.runId,
      code: raw.code,
      language: raw.language ?? '',
      mode: raw.mode,
    })
    if (!tokenCheck.ok) return { success: false, error: tokenCheck.error }
    const normalised: ComputeRunRequest = {
      runId: raw.runId,
      code: raw.code,
      mode: raw.mode,
      timeoutSec: raw.timeoutSec,
      language: raw.language,
      context: asContext(raw.context),
      resources: asResources(raw.resources),
      ...(typeof raw.sessionId === 'string' && raw.sessionId
        ? { sessionId: raw.sessionId }
        : {}),
      ...(typeof raw.artifactId === 'string' && raw.artifactId
        ? { artifactId: raw.artifactId }
        : {}),
    }
    return manager!.run(normalised)
  })

  ipcMain.handle('compute:cancel', async (_event, runId: unknown) => {
    if (typeof runId !== 'string') {
      return { success: false }
    }
    return manager!.cancel(runId)
  })

  ipcMain.handle('compute:test-connection', async (_event, req: unknown) => {
    if (!isValidTestRequest(req)) {
      return {
        container_up: false,
        error: 'Invalid compute:test-connection payload',
      }
    }
    const raw = req as ComputeTestRequest
    return manager!.testConnection({ mode: raw.mode }, { force: true })
  })

  // Open an archived compute workdir in the host file manager (Finder
  // / Explorer / xdg-open). Safety: reject any path that isn't under
  // the managed workspace compute archive or the legacy userData archive
  // so the renderer can't abuse this IPC to pop up arbitrary folders.
  ipcMain.handle('compute:open-workdir', async (_event, target: unknown) => {
    if (typeof target !== 'string' || !target) {
      return { success: false, error: 'missing workdir path' }
    }
    const resolved = path.resolve(target)
    const allowedRoots = computeArchiveRoots()
    const isAllowed = allowedRoots.some((root) => (
      resolved === root || resolved.startsWith(root + path.sep)
    ))
    if (!isAllowed) {
      return { success: false, error: 'path outside compute workspace' }
    }
    if (!fs.existsSync(resolved)) {
      return { success: false, error: 'workdir no longer exists (pruned?)' }
    }
    const err = await shell.openPath(resolved)
    if (err) return { success: false, error: err }
    return { success: true }
  })

  return manager
}

export function getComputeManager(): ComputeRunnerManager | null {
  return manager
}
