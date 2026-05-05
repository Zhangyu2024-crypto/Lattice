import { app, ipcMain, shell } from 'electron'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import {
  clearAuditLogs,
  configureAudit,
  flushAuditEvents,
  getAuditLogDir,
  getAuditStatus,
} from './audit-writer'

interface ConfigureAuditPayload {
  enabled?: unknown
  acceptedAgreementVersion?: unknown
  currentAgreementVersion?: unknown
  retentionDays?: unknown
}

function readConfigPayload(payload: unknown): ConfigureAuditPayload {
  return payload && typeof payload === 'object'
    ? (payload as ConfigureAuditPayload)
    : {}
}

function exportFileName(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `lattice-api-audit-${stamp}.zip`
}

export function registerAuditIpc(): void {
  ipcMain.handle('audit:get-status', () => getAuditStatus())

  ipcMain.handle('audit:configure', (_event, payload: unknown) => {
    const req = readConfigPayload(payload)
    return configureAudit({
      enabled: req.enabled === true,
      acceptedAgreementVersion:
        typeof req.acceptedAgreementVersion === 'string'
          ? req.acceptedAgreementVersion
          : req.acceptedAgreementVersion === null
            ? null
            : undefined,
      currentAgreementVersion:
        typeof req.currentAgreementVersion === 'string'
          ? req.currentAgreementVersion
          : undefined,
      retentionDays:
        typeof req.retentionDays === 'number' ? req.retentionDays : undefined,
    })
  })

  ipcMain.handle('audit:open-log-dir', async () => {
    const dir = getAuditLogDir()
    await mkdir(dir, { recursive: true })
    const result = await shell.openPath(dir)
    return result ? { ok: false, error: result } : { ok: true, logDir: dir }
  })

  ipcMain.handle('audit:clear-logs', async () => {
    await clearAuditLogs()
    return { ok: true, logDir: getAuditLogDir() }
  })

  ipcMain.handle('audit:export-logs', async () => {
    await flushAuditEvents()
    const dir = getAuditLogDir()
    await mkdir(dir, { recursive: true })
    const downloads = app.getPath('downloads')
    const target = path.join(downloads, exportFileName())
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()
    const { readdir, readFile, writeFile } = await import('node:fs/promises')
    let count = 0
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      if (!/^audit-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)) continue
      zip.file(name, await readFile(path.join(dir, name)))
      count += 1
    }
    await writeFile(target, await zip.generateAsync({ type: 'nodebuffer' }))
    return { ok: true, path: target, fileCount: count }
  })
}
