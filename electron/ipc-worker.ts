// IPC handlers for the Python worker (Self-contained Port §P4-α).
//
// The worker is lazy-spawned: `worker:status` returns 'idle' until
// `worker:call` (or `worker:start`) is invoked. Renderer code that
// wants the worker hot for a UX surface (e.g. status bar, settings
// panel) should call `worker:start` explicitly.

import { ipcMain, type BrowserWindow } from 'electron'
import { WorkerManager, type WorkerCallRequest } from './worker-manager'

let manager: WorkerManager | null = null
let registered = false

function ensureManager(getWindow: () => BrowserWindow | null): WorkerManager {
  if (!manager) manager = new WorkerManager(getWindow)
  return manager
}

export function registerWorkerIpc(
  getWindow: () => BrowserWindow | null,
): WorkerManager {
  const m = ensureManager(getWindow)
  if (registered) return m
  registered = true

  ipcMain.handle('worker:status', () => m.getStatus())

  ipcMain.handle('worker:start', async () => {
    try {
      await m.start()
      return { success: true, status: m.getStatus() }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        status: m.getStatus(),
      }
    }
  })

  ipcMain.handle('worker:call', async (_event, raw: unknown) => {
    if (!raw || typeof raw !== 'object') {
      return {
        success: false,
        error: 'Invalid worker:call payload',
        durationMs: 0,
      }
    }
    const req = raw as Partial<WorkerCallRequest>
    if (typeof req.method !== 'string') {
      return {
        success: false,
        error: 'worker:call requires a `method` string',
        durationMs: 0,
      }
    }
    return m.call({
      method: req.method,
      params: (req.params ?? {}) as Record<string, unknown>,
      timeoutMs:
        typeof req.timeoutMs === 'number' ? req.timeoutMs : undefined,
    })
  })

  ipcMain.handle('worker:health', async () => m.health())

  ipcMain.handle('worker:stop', async () => {
    await m.stop()
    return { success: true }
  })

  return m
}

export function getWorkerManager(): WorkerManager | null {
  return manager
}
