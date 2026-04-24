// User-saved compute script CRUD.
//
// Replaces lattice-cli's `/api/pro/compute/save-script | scripts | script/{name}`
// REST surface so ComputeProWorkbench can run without any external backend
// (Self-contained Port Plan §P1, docs/SELF_CONTAINED_PORT_PLAN_2026-04-13.md).
//
// Scripts live under `app.getPath('userData')/compute-scripts/` as one JSON
// file each. The on-disk filename is hex-encoded from the user-supplied
// name so arbitrary characters (spaces, non-ASCII, `/`, etc.) survive round-
// tripping; a separate `displayFilename` is computed for UI/list output so
// users still see a recognisable name.

import { app, ipcMain } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

interface StoredComputeScript {
  name: string
  code: string
  modified: number
}

const NAME_MAX = 200
const DISPLAY_FILENAME_MAX = 80
// Windows reserved characters + path separators — stripped from the
// UI-facing filename only; the storage filename is hex and safe.
const DISPLAY_REPLACE = /[\\/:*?"<>|]+/g

let registered = false

function scriptsDir(): string {
  return path.join(app.getPath('userData'), 'compute-scripts')
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  // Cap to avoid an accidentally pasted 10MB "name" blowing up the file
  // system. Well past anything legitimate.
  return trimmed.slice(0, NAME_MAX)
}

function displayFilename(name: string): string {
  const safe = name.replace(DISPLAY_REPLACE, '_').slice(0, DISPLAY_FILENAME_MAX)
  return `${safe || 'script'}.json`
}

function storageFilename(name: string): string {
  const hex = Buffer.from(name, 'utf8').toString('hex')
  return `${hex || 'script'}.json`
}

function scriptPath(name: string): string {
  return path.join(scriptsDir(), storageFilename(name))
}

async function ensureScriptsDir(): Promise<void> {
  await fs.mkdir(scriptsDir(), { recursive: true })
}

function parseStoredScript(raw: string): StoredComputeScript | null {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>
    const name = normalizeName(data.name)
    if (!name) return null
    if (typeof data.code !== 'string') return null
    const modified =
      typeof data.modified === 'number' && Number.isFinite(data.modified)
        ? Math.floor(data.modified)
        : nowSeconds()
    return { name, code: data.code, modified }
  } catch {
    return null
  }
}

/**
 * Atomic write: write to a sibling `.tmp` then rename. Avoids a partial
 * JSON file being picked up by `list` if the app crashes mid-write.
 */
async function writeJsonAtomic(targetPath: string, body: string): Promise<void> {
  const tmp = `${targetPath}.tmp`
  await fs.writeFile(tmp, body, 'utf8')
  await fs.rename(tmp, targetPath)
}

async function listStoredScripts(): Promise<
  Array<{ name: string; filename: string; size: number; modified: number }>
> {
  await ensureScriptsDir()
  const entries = await fs.readdir(scriptsDir(), { withFileTypes: true })
  const rows = await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.endsWith('.json') &&
          !entry.name.endsWith('.tmp'),
      )
      .map(async (entry) => {
        const filePath = path.join(scriptsDir(), entry.name)
        try {
          const [raw, stat] = await Promise.all([
            fs.readFile(filePath, 'utf8'),
            fs.stat(filePath),
          ])
          const parsed = parseStoredScript(raw)
          if (!parsed) return null
          return {
            name: parsed.name,
            filename: displayFilename(parsed.name),
            size: stat.size,
            modified: parsed.modified,
          }
        } catch {
          // A single corrupt / unreadable file must not fail the whole list.
          return null
        }
      }),
  )
  return rows
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort(
      (a, b) => b.modified - a.modified || a.name.localeCompare(b.name),
    )
}

export function registerComputeScriptsIpc(): void {
  if (registered) return
  registered = true

  ipcMain.handle('compute-scripts:save', async (_event, req: unknown) => {
    const body = (req ?? {}) as Record<string, unknown>
    const name = normalizeName(body.name)
    if (!name || typeof body.code !== 'string') {
      return {
        success: false,
        error: 'Invalid compute-scripts:save payload: name and code are required strings.',
      }
    }
    try {
      await ensureScriptsDir()
      const modified = nowSeconds()
      const record: StoredComputeScript = { name, code: body.code, modified }
      const filePath = scriptPath(name)
      await writeJsonAtomic(filePath, JSON.stringify(record, null, 2))
      return { success: true, name, path: filePath, modified }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  })

  ipcMain.handle('compute-scripts:list', async () => {
    try {
      return { scripts: await listStoredScripts() }
    } catch {
      // Fresh install with no userData dir yet, etc. An empty list is the
      // honest answer rather than surfacing a low-level ENOENT.
      return { scripts: [] }
    }
  })

  ipcMain.handle('compute-scripts:load', async (_event, rawName: unknown) => {
    const name = normalizeName(rawName)
    if (!name) {
      return { success: false, error: 'Invalid script name.' }
    }
    try {
      const raw = await fs.readFile(scriptPath(name), 'utf8')
      const parsed = parseStoredScript(raw)
      if (!parsed) {
        return { success: false, error: 'Corrupt compute script file.' }
      }
      return {
        success: true,
        name: parsed.name,
        filename: displayFilename(parsed.name),
        code: parsed.code,
        modified: parsed.modified,
      }
    } catch (err) {
      const code = (err as { code?: string })?.code
      if (code === 'ENOENT') {
        return { success: false, error: `Script not found: ${name}` }
      }
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  })
}
