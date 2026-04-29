import { app, BrowserWindow, ipcMain, dialog, net, protocol } from 'electron'
import { promises as fs } from 'node:fs'
import { watch as fsWatch, type FSWatcher } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { PythonManager } from './python-manager'
import { registerLlmIpc } from './ipc-llm'
import { registerComputeIpc, getComputeManager } from './ipc-compute'


import { registerComputeScriptsIpc } from './ipc-compute-scripts'
import { registerComputeWorkspaceIpc } from './ipc-compute-workspace'
import { ensureCondaUnpacked } from './conda-env-manager'
import { registerLibraryIpc, resolveLibraryPdfPath } from './ipc-library'
import { registerLiteratureIpc } from './ipc-literature'
import { registerWorkerIpc, getWorkerManager } from './ipc-worker'
import { registerWorkspaceIpc } from './ipc-workspace'
import { registerApprovalTokenIpc, consumeApprovalToken } from './ipc-approval-tokens'
import {
  registerWorkspaceRootIpc,
  closeAllWorkspaceWatchers,
} from './ipc-workspace-root'
import { registerSyncIpc } from './ipc-sync'
import { registerResearchIpc } from './ipc-research'
import { registerMcpIpc, shutdownAllMcpClients } from './ipc-mcp'
import { readManifest } from './sync/manifest'
import {
  push as syncPush,
  pull as syncPull,
  hasDirty as syncHasDirty,
} from './sync/manager'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'lattice-pdf',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

let mainWindow: BrowserWindow | null = null
let libraryWindow: BrowserWindow | null = null
const pythonManager = new PythonManager()

function broadcastBackendStatus(payload: {
  ready: boolean
  port?: number
  token?: string
  error?: string
}) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('backend:status', payload)
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: 'Lattice',
    backgroundColor: '#1e1e1e',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      // Must match vite.config.ts preload output filename. Uses `.mjs` so
      // Electron's preload loader treats it as ESM (required when
      // package.json has `"type": "module"`) — a `.js` ESM file triggers
      // ERR_REQUIRE_ESM and silently drops `window.electronAPI`.
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Electron 12+ defaults `plugins: false`, which disables Chromium's
      // built-in PDFium viewer. Without this flag the PDF blob iframe
      // (PdfContinuousViewer → `<iframe src="blob:...">`) renders blank
      // because Chromium has no handler for `application/pdf`. Enabling
      // `plugins` here only re-attaches PDFium and the older NaCl plugin
      // surface — it does NOT bring back Flash or any actively-loaded
      // third-party plugin (those are removed from Chromium itself).
      plugins: true,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // `webContents.send` does NOT buffer messages — if the renderer isn't
  // subscribed when a push goes out, the push is dropped. Python can become
  // ready BEFORE React mounts + subscribes, so the initial ready push would
  // be lost. Re-send the current backend state once the page finishes loading
  // so the renderer always gets the latest status.
  mainWindow.webContents.on('did-finish-load', () => {
    if (pythonManager.isReady) {
      mainWindow?.webContents.send('backend:status', {
        ready: true,
        port: pythonManager.backendPort,
        token: pythonManager.backendToken,
      })
    }
  })

  // Forward renderer-side console output to the terminal running the dev
  // server so we can diagnose "blank screen" regressions without asking
  // the user to open DevTools. Dev-only — the mirrored logs are noisy in
  // production and the user has access to DevTools there anyway.
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.webContents.on('console-message', (_e, level, msg, line, src) => {
      const tag = ['log', 'warn', 'error', 'debug'][level] ?? String(level)
      console.log(`[renderer:${tag}] ${msg}  (${src}:${line})`)
    })
    mainWindow.webContents.on('render-process-gone', (_e, details) => {
      console.error('[renderer] process gone:', details)
    })
    mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
      console.error(`[renderer] did-fail-load ${code} ${desc} ${url}`)
      // Dev-only: Vite's transform pipeline can still be warming when
      // Electron's `loadURL` fires on cold boot. The first fetch bounces
      // with ERR_CONNECTION_RESET / ERR_CONNECTION_REFUSED / ERR_ABORTED
      // even though the dev server is seconds away from being ready.
      // Auto-retry once after a short backoff so the user doesn't have
      // to Ctrl+R the window. We only retry transient network codes for
      // the main document URL — subresource failures don't surface here.
      const RETRYABLE = new Set([-101, -102, -111, -3])
      const devUrl = process.env.VITE_DEV_SERVER_URL
      if (!devUrl) return
      if (!url || !url.startsWith(devUrl)) return
      if (!RETRYABLE.has(code)) return
      const retryCountRaw = (mainWindow?.webContents as unknown as {
        __latticeLoadRetries?: number
      }) ?? null
      const retries = retryCountRaw?.__latticeLoadRetries ?? 0
      if (retries >= 3) return
      if (retryCountRaw) retryCountRaw.__latticeLoadRetries = retries + 1
      setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return
        console.log(`[renderer] retry loadURL (attempt ${retries + 1}/3)`)
        mainWindow.loadURL(devUrl).catch(() => {
          // Let the did-fail-load handler pick up any follow-up failure.
        })
      }, 500 + retries * 500)
    })
  }

  // Allow blob: downloads triggered by the renderer (CSV / CIF / PNG
  // export). Electron shows a "Save As" dialog by default when
  // will-download fires without setSavePath — just log for diagnostics.
  mainWindow.webContents.session.on('will-download', (_event, item) => {
    console.log(`[download] ${item.getFilename()} (${item.getTotalBytes()} bytes)`)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function createLibraryWindow() {
  if (libraryWindow && !libraryWindow.isDestroyed()) {
    libraryWindow.focus()
    return
  }
  libraryWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 880,
    minHeight: 520,
    title: 'Lattice — Library',
    backgroundColor: '#1e1e1e',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      plugins: true,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    void libraryWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}#/library`)
  } else {
    void libraryWindow.loadFile(path.join(__dirname, '../dist/index.html'), {
      hash: 'library',
    })
  }

  libraryWindow.webContents.on('did-finish-load', () => {
    if (pythonManager.isReady) {
      libraryWindow?.webContents.send('backend:status', {
        ready: true,
        port: pythonManager.backendPort,
        token: pythonManager.backendToken,
      })
    }
  })

  libraryWindow.on('closed', () => {
    libraryWindow = null
  })
}

function createWorkbenchWindow(sessionId: string, artifactId: string) {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 880,
    minHeight: 520,
    title: 'Lattice — Workbench',
    backgroundColor: '#1e1e1e',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      plugins: true,
    },
  })

  const q = new URLSearchParams({ sessionId, artifactId }).toString()
  if (process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(`${process.env.VITE_DEV_SERVER_URL}#/workbench?${q}`)
  } else {
    void win.loadFile(path.join(__dirname, '../dist/index.html'), {
      hash: `workbench?${q}`,
    })
  }

  win.webContents.on('did-finish-load', () => {
    if (pythonManager.isReady) {
      win.webContents.send('backend:status', {
        ready: true,
        port: pythonManager.backendPort,
        token: pythonManager.backendToken,
      })
    }
  })

  win.on('closed', () => {
    // Each workbench is independent; no single global reference.
  })
}

function createPdfReaderWindow(relPath: string) {
  const parent = mainWindow ?? undefined
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 500,
    parent,
    alwaysOnTop: true,
    title: `Lattice — ${path.basename(relPath)}`,
    backgroundColor: '#1e1e1e',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      plugins: true,
    },
  })

  const q = new URLSearchParams({ relPath }).toString()
  if (process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(`${process.env.VITE_DEV_SERVER_URL}#/pdf-reader?${q}`)
  } else {
    void win.loadFile(path.join(__dirname, '../dist/index.html'), {
      hash: `pdf-reader?${q}`,
    })
  }
}

ipcMain.handle('pdf-reader:open', (_event, payload: { relPath: string }) => {
  createPdfReaderWindow(payload.relPath)
  return { ok: true }
})

function createDataManagerWindow() {
  const parent = mainWindow ?? undefined
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    parent,
    alwaysOnTop: true,
    title: 'Lattice — Data Management',
    backgroundColor: '#1e1e1e',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(`${process.env.VITE_DEV_SERVER_URL}#/data-manager`)
  } else {
    void win.loadFile(path.join(__dirname, '../dist/index.html'), {
      hash: 'data-manager',
    })
  }
}

ipcMain.handle('data-manager:open', () => {
  createDataManagerWindow()
  return { ok: true }
})

// IPC: file dialogs
ipcMain.handle('dialog:openFile', async (event, options) => {
  const parent = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
  if (!parent) return null
  const result = await dialog.showOpenDialog(parent, {
    properties: ['openFile'],
    filters: [
      { name: 'Spectrum Files', extensions: ['xy', 'csv', 'spc', 'wdf', 'jdx', 'dx', 'vms', 'spe', 'cif', 'dat', 'txt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    ...options,
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('dialog:openDirectory', async (event, options) => {
  const parent = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
  if (!parent) return null
  const result = await dialog.showOpenDialog(parent, {
    properties: ['openDirectory'],
    ...options,
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle(
  'workbench-window:open',
  (_event, payload: { sessionId: string; artifactId: string }) => {
    try {
      createWorkbenchWindow(payload.sessionId, payload.artifactId)
      return { success: true }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  },
)

// User-skill discovery for the slash-command registry. Each `.md` file
// under `<userData>/skills/` becomes a prompt-type /command; see
// `src/lib/slash-commands/loaders/skills.ts` for the frontmatter spec.
// We create the dir on first call so `ls` works out-of-the-box.
//
// The renderer receives `{ skills, errors }`: per-file read failures are
// preserved so `/help` can list filenames that failed to parse instead of
// silently dropping them.
ipcMain.handle('slash:list-skills', async () => {
  const dir = path.join(app.getPath('userData'), 'skills')
  try {
    await fs.mkdir(dir, { recursive: true })
    const entries = await fs.readdir(dir)
    const skills: Array<{ fileName: string; source: string }> = []
    const errors: Array<{ fileName: string; message: string }> = []
    for (const name of entries) {
      if (!name.toLowerCase().endsWith('.md')) continue
      const full = path.join(dir, name)
      try {
        const stat = await fs.stat(full)
        if (!stat.isFile()) continue
        const source = await fs.readFile(full, 'utf8')
        skills.push({ fileName: name, source })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        errors.push({ fileName: name, message })
      }
    }
    // Ensure the watcher is running so any future edits push an update.
    ensureSkillsWatcher(dir)
    return { skills, errors }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { skills: [], errors: [{ fileName: '<directory>', message }] }
  }
})


interface PluginToolManifest {
  plugin: string
  name: string
  description?: string
  inputSchema?: unknown
  command: string
  args: string[]
  timeoutMs?: number
}

function normalizePluginTool(
  plugin: string,
  raw: unknown,
): PluginToolManifest | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  if (typeof item.name !== 'string' || item.name.trim().length === 0) return null
  if (typeof item.command !== 'string' || item.command.trim().length === 0) return null
  const args = Array.isArray(item.args)
    ? item.args.filter((arg): arg is string => typeof arg === 'string')
    : []
  const timeoutMs =
    typeof item.timeoutMs === 'number' && Number.isFinite(item.timeoutMs)
      ? Math.max(1000, Math.min(Math.floor(item.timeoutMs), 120_000))
      : undefined
  return {
    plugin,
    name: item.name.trim(),
    description:
      typeof item.description === 'string' ? item.description : undefined,
    inputSchema: item.inputSchema,
    command: item.command.trim(),
    args,
    timeoutMs,
  }
}

async function readPluginTools(root: string): Promise<{
  tools: PluginToolManifest[]
  errors: Array<{ plugin: string; message: string }>
}> {
  const tools: PluginToolManifest[] = []
  const errors: Array<{ plugin: string; message: string }> = []
  await fs.mkdir(root, { recursive: true })
  const entries = await fs.readdir(root, { withFileTypes: true })
  for (const dirent of entries) {
    if (!dirent.isDirectory()) continue
    const plugin = dirent.name
    try {
      const raw = await fs.readFile(path.join(root, plugin, 'plugin.json'), 'utf8')
      const parsed = JSON.parse(raw) as { tools?: unknown }
      if (!Array.isArray(parsed.tools)) continue
      for (const entry of parsed.tools) {
        const tool = normalizePluginTool(plugin, entry)
        if (tool) tools.push(tool)
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code
      if (code === 'ENOENT') continue
      errors.push({
        plugin,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return { tools, errors }
}

function runPluginTool(opts: {
  pluginRoot: string
  tool: PluginToolManifest
  input: Record<string, unknown>
}): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  const timeoutMs = opts.tool.timeoutMs ?? 30_000
  const MAX_OUTPUT = 2 * 1024 * 1024
  return new Promise((resolve) => {
    let settled = false
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const child = spawn(opts.tool.command, opts.tool.args, {
      cwd: opts.pluginRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    })
    const timer = setTimeout(() => {
      if (settled) return
      timedOut = true
      settled = true
      try {
        child.kill('SIGKILL')
      } catch {
        // best effort
      }
      resolve({ code: -1, stdout, stderr: stderr || 'timeout', timedOut })
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk.toString('utf8')
    })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: err.message, timedOut })
    })
    child.on('exit', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr, timedOut })
    })
    child.stdin.end(
      JSON.stringify({
        input: opts.input,
        context: { plugin: opts.tool.plugin, tool: opts.tool.name },
      }),
    )
  })
}

// Plugin discovery. Each `<userData>/plugins/<name>/` is a plugin.
// `plugin.json` supplies metadata plus optional executable tool manifests,
// and any markdown under `skills/` becomes slash commands. Executable tools
// run as JSON stdin/stdout subprocesses and are hostExec-gated in Agent.
ipcMain.handle('slash:list-plugins', async () => {
  const root = path.join(app.getPath('userData'), 'plugins')
  const result: Array<{
    name: string
    manifest: { name?: string; description?: string; version?: string }
    skills: Array<{ fileName: string; source: string }>
    tools: Array<{ name: string; description?: string; inputSchema?: unknown }>
    error?: string
  }> = []
  try {
    await fs.mkdir(root, { recursive: true })
    const entries = await fs.readdir(root, { withFileTypes: true })
    for (const dirent of entries) {
      if (!dirent.isDirectory()) continue
      const name = dirent.name
      const pluginRoot = path.join(root, name)
      let manifest: {
        name?: string
        description?: string
        version?: string
      } = {}
      let tools: Array<{ name: string; description?: string; inputSchema?: unknown }> = []
      try {
        const raw = await fs.readFile(
          path.join(pluginRoot, 'plugin.json'),
          'utf8',
        )
        const parsed = JSON.parse(raw)
        manifest = {
          name: typeof parsed.name === 'string' ? parsed.name : undefined,
          description:
            typeof parsed.description === 'string'
              ? parsed.description
              : undefined,
          version:
            typeof parsed.version === 'string' ? parsed.version : undefined,
        }
        if (Array.isArray(parsed.tools)) {
          tools = parsed.tools
            .map((entry: unknown) => normalizePluginTool(name, entry))
            .filter((entry: PluginToolManifest | null): entry is PluginToolManifest => Boolean(entry))
            .map((tool: PluginToolManifest) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
            }))
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        // Missing plugin.json is fine — plugin can be skills-only. Parse
        // errors surface back so Settings can show them.
        if (
          !(err as NodeJS.ErrnoException | undefined)?.code ||
          (err as NodeJS.ErrnoException).code !== 'ENOENT'
        ) {
          result.push({ name, manifest: {}, skills: [], tools: [], error: message })
          continue
        }
      }

      const skills: Array<{ fileName: string; source: string }> = []
      const skillsDir = path.join(pluginRoot, 'skills')
      try {
        const files = await fs.readdir(skillsDir)
        for (const file of files) {
          if (!file.toLowerCase().endsWith('.md')) continue
          try {
            const source = await fs.readFile(
              path.join(skillsDir, file),
              'utf8',
            )
            skills.push({ fileName: file, source })
          } catch {
            // Skip unreadable files without poisoning the whole plugin.
          }
        }
      } catch {
        // No skills dir → plugin has no commands. Still list it so users
        // see it in Settings and know it was scanned.
      }

      result.push({ name, manifest, skills, tools })
    }
    ensurePluginsWatcher(root)
    return { plugins: result }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { plugins: [], error: message }
  }
})


ipcMain.handle('plugin:list-tools', async () => {
  const root = path.join(app.getPath('userData'), 'plugins')
  try {
    const { tools, errors } = await readPluginTools(root)
    ensurePluginsWatcher(root)
    return {
      tools: tools.map(({ command: _command, args: _args, timeoutMs: _timeoutMs, ...tool }) => tool),
      errors,
    }
  } catch (err) {
    return {
      tools: [],
      errors: [
        {
          plugin: '<directory>',
          message: err instanceof Error ? err.message : String(err),
        },
      ],
    }
  }
})

ipcMain.handle(
  'plugin:call-tool',
  async (
    _event,
    payload: {
      plugin: string
      name: string
      input?: Record<string, unknown>
      approvalToken?: string
    },
  ) => {
    const plugin = typeof payload?.plugin === 'string' ? payload.plugin : ''
    const name = typeof payload?.name === 'string' ? payload.name : ''
    if (!plugin || plugin.includes('/') || plugin.includes('\\')) {
      throw new Error('Invalid plugin name')
    }
    if (!name) throw new Error('Tool name is required')
    const tokenCheck = consumeApprovalToken(payload.approvalToken, 'plugin_call_tool', {
      plugin,
      name,
      input: JSON.stringify(payload.input ?? {}),
    })
    if (!tokenCheck.ok) throw new Error(tokenCheck.error)

    const root = path.join(app.getPath('userData'), 'plugins')
    const { tools } = await readPluginTools(root)
    const tool = tools.find((entry) => entry.plugin === plugin && entry.name === name)
    if (!tool) throw new Error(`Plugin tool not found: ${plugin}/${name}`)
    const pluginRoot = path.join(root, plugin)
    const result = await runPluginTool({
      pluginRoot,
      tool,
      input: payload.input ?? {},
    })
    if (result.code !== 0) {
      throw new Error(
        `Plugin tool failed (${result.code})${result.timedOut ? ' after timeout' : ''}: ${result.stderr || result.stdout}`,
      )
    }
    const trimmed = result.stdout.trim()
    if (!trimmed) return { output: null, stdout: '', stderr: result.stderr }
    try {
      const parsed = JSON.parse(trimmed) as { ok?: boolean; output?: unknown; error?: string }
      if (parsed && typeof parsed === 'object' && parsed.ok === false) {
        throw new Error(parsed.error ?? 'Plugin tool returned ok=false')
      }
      if (parsed && typeof parsed === 'object' && 'output' in parsed) {
        return { output: parsed.output, stdout: result.stdout, stderr: result.stderr }
      }
      return { output: parsed, stdout: result.stdout, stderr: result.stderr }
    } catch (err) {
      if (err instanceof SyntaxError) {
        return { output: result.stdout, stdout: result.stdout, stderr: result.stderr }
      }
      throw err
    }
  },
)

let pluginsWatcher: FSWatcher | null = null
let pluginsWatchedDir: string | null = null
let pluginsDebounce: NodeJS.Timeout | null = null
function ensurePluginsWatcher(dir: string): void {
  if (pluginsWatcher && pluginsWatchedDir === dir) return
  if (pluginsWatcher) {
    pluginsWatcher.close()
    pluginsWatcher = null
  }
  try {
    pluginsWatcher = fsWatch(
      dir,
      { persistent: false, recursive: true },
      () => {
        if (pluginsDebounce) clearTimeout(pluginsDebounce)
        pluginsDebounce = setTimeout(() => {
          for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed())
              win.webContents.send('slash:plugins-changed')
          }
        }, 200)
      },
    )
    pluginsWatchedDir = dir
  } catch {
    // Recursive watch isn't supported on every platform (Linux notably).
    // Degrade to rescan-on-demand via the Settings button.
  }
}

// One watcher for the whole main-process lifetime. `fs.watch` is cheap and
// event-driven — we debounce because editors typically fire two or three
// events per save (rename, change, change) and we only want one reload.
let skillsWatcher: FSWatcher | null = null
let skillsWatchedDir: string | null = null
let skillsDebounce: NodeJS.Timeout | null = null
function ensureSkillsWatcher(dir: string): void {
  if (skillsWatcher && skillsWatchedDir === dir) return
  if (skillsWatcher) {
    skillsWatcher.close()
    skillsWatcher = null
  }
  try {
    skillsWatcher = fsWatch(dir, { persistent: false }, (_event, filename) => {
      if (filename && !String(filename).toLowerCase().endsWith('.md')) return
      if (skillsDebounce) clearTimeout(skillsDebounce)
      skillsDebounce = setTimeout(() => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send('slash:skills-changed')
        }
      }, 150)
    })
    skillsWatchedDir = dir
  } catch {
    // fs.watch can fail on some platforms / network mounts — degrade to
    // boot-time-only warming without noise.
  }
}

ipcMain.handle('workbench-window:close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win && !win.isDestroyed()) {
    win.close()
  }
  return { success: true }
})

ipcMain.handle(
  'research:export-pdf',
  async (
    event,
    payload: { defaultFileName?: string; pageSize?: 'A4' | 'Letter' },
  ) => {
      const parent = BrowserWindow.fromWebContents(event.sender)
    const rawBase = (payload.defaultFileName ?? 'research-report')
      .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
    const fileName = rawBase.toLowerCase().endsWith('.pdf')
      ? rawBase
      : `${rawBase}.pdf`

    try {
      const save = parent
        ? await dialog.showSaveDialog(parent, {
            title: 'Export research report as PDF',
            defaultPath: path.join(app.getPath('documents'), fileName),
            filters: [{ name: 'PDF', extensions: ['pdf'] }],
          })
        : await dialog.showSaveDialog({
          title: 'Export research report as PDF',
          defaultPath: path.join(app.getPath('documents'), fileName),
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        })
      if (save.canceled || !save.filePath) {
        return { ok: false, canceled: true }
      }

      const pageSize = payload.pageSize === 'A4' ? 'A4' : 'Letter'
      const pdf = await event.sender.printToPDF({
        printBackground: true,
        pageSize,
        preferCSSPageSize: false,
        margins: { marginType: 'custom', top: 0.8, bottom: 0.8, left: 0.7, right: 0.7 },
        displayHeaderFooter: true,
        headerTemplate: '<div></div>',
        footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#888;font-family:system-ui,sans-serif;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      })
      await fs.writeFile(save.filePath, pdf)
      return {
        ok: true,
        filePath: save.filePath,
        pageSize,
      }
    } catch (err: unknown) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  },
)

ipcMain.handle('library-window:open', () => {
  try {
    createLibraryWindow()
    return { success: true }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: message }
  }
})

ipcMain.handle('library-window:close', () => {
  if (libraryWindow && !libraryWindow.isDestroyed()) {
    libraryWindow.close()
  }
  libraryWindow = null
  return { success: true }
})

ipcMain.on('library:send-paper-to-main', (_event, payload) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('library:open-paper', payload)
    mainWindow.focus()
  }
})

// IPC: backend connection info
ipcMain.handle('backend:getInfo', () => {
  return {
    ready: pythonManager.isReady,
    port: pythonManager.backendPort,
    token: pythonManager.backendToken,
    baseUrl: pythonManager.baseUrl,
  }
})

ipcMain.handle('backend:start', async () => {
  if (pythonManager.isReady) return { success: true }
  try {
    await pythonManager.start({
      latticeCliPath: process.env.LATTICE_CLI_PATH || undefined,
    })
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
})

// IPC: XRD → BGMN Rietveld status. dara-xrd is now a bundled dependency
// (pip install dara-xrd ships the BGMN binary). Always report configured;
// actual availability is validated at call time by the worker.
ipcMain.handle('xrd:dara-status', () => {
  return { configured: true }
})

// IPC: generic "Save As" for text/binary exports (CSV, CIF, JSON).
// The renderer calls this instead of `<a download>` blob tricks that
// Electron silently swallows.
ipcMain.handle(
  'file:save-dialog',
  async (
    event,
    payload: {
      defaultFileName: string
      content: string
      filters?: Array<{ name: string; extensions: string[] }>
    },
  ) => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const opts = {
      title: 'Save file',
      defaultPath: path.join(
        app.getPath('documents'),
        payload.defaultFileName,
      ),
      filters: payload.filters ?? [{ name: 'All Files', extensions: ['*'] }],
    }
    const save = parent
      ? await dialog.showSaveDialog(parent, opts)
      : await dialog.showSaveDialog(opts)
    if (save.canceled || !save.filePath) return { ok: false, canceled: true }
    await fs.writeFile(save.filePath, payload.content, 'utf-8')
    return { ok: true, filePath: save.filePath }
  },
)

// IPC: LLM proxy (direct HTTP to Anthropic/OpenAI from main process)
registerLlmIpc()

// IPC: Docker-backed Python compute runner
registerComputeIpc(() => mainWindow)

// Embedded conda environment: fix prefixes on first launch.
void ensureCondaUnpacked()

// IPC: Compute script CRUD under userData (Self-contained Port §P1 —
// replaces lattice-cli's /api/pro/compute/{save-script,scripts,script/:name}).
registerComputeScriptsIpc()

// IPC: compute:list-dir-at — independent directory listing for the Compute
// overlay's Assets rail. Unlike `workspace:list` (anchored to the app's
// single shared workspace root), this one accepts an arbitrary absolute
// path so the Compute workbench can point at a different folder without
// affecting the main Explorer.
registerComputeWorkspaceIpc()

// IPC: Local reference library (Self-contained Port §P3 v1 — replaces
// `/api/library/papers` GET/POST for InverseDesignCard's path; other
// Library consumers (LibraryModal, PaperArtifactCard) still talk to
// lattice-cli until later P3 phases migrate them).
registerLibraryIpc()

// IPC: OpenAlex + arXiv literature search. Wired in from the main process
// so the renderer's CSP (which blocks cross-origin HTTPS other than
// backend + providers) isn't a concern. Feeds the `literature_search`
// agent tool — see `src/lib/agent-tools/literature-search.ts`.
registerLiteratureIpc()

// IPC: Repo-local Python worker (Self-contained Port §P4-α). Lazy-spawn
// — `worker:status` returns `idle` until something invokes it; the
// renderer's StatusBar / "Test Python worker" command exercises it on
// demand.
registerWorkerIpc(() => mainWindow)

registerApprovalTokenIpc()

// IPC: workspace bash passthrough. Executes a shell command with the
// user-supplied cwd (typically `useWorkspaceStore().rootPath`). Gated at
// the tool layer by the B+ approval dialog (`workspace_bash` is
// trustLevel: 'hostExec', so every run prompts the user).
registerWorkspaceIpc()

// IPC: user-facing research workspace root (file-centric UI). Uses
// chokidar watchers + `workspace:read / :write / :list / :stat` channels.
// Complementary to the bash passthrough above (which uses
// `workspace:bash`).
registerWorkspaceRootIpc(() => mainWindow)

// IPC: cloud sync (WebDAV / rclone) for library + research drafts.
let syncIntervalTimer: ReturnType<typeof setInterval> | null = null

function restartSyncInterval(): void {
  if (syncIntervalTimer) {
    clearInterval(syncIntervalTimer)
    syncIntervalTimer = null
  }
  readManifest().then((manifest) => {
    const mins = manifest.sync_interval
    if (!mins || mins <= 0 || !manifest.backend || !manifest.remote_url) return
    console.log(`[Lattice] sync interval: every ${mins} min`)
    syncIntervalTimer = setInterval(() => {
      syncPull({ force: false })
        .then(() => syncPush({ force: false }))
        .then(() => console.log('[Lattice] interval sync done'))
        .catch((err: Error) => console.warn('[Lattice] interval sync failed:', err.message))
    }, mins * 60_000)
  }).catch(() => { /* manifest unreadable — skip */ })
}

registerSyncIpc({ onIntervalChanged: restartSyncInterval })

// IPC: mirror research-report artifacts from renderer (localStorage) to
// `${userData}/research/` so they participate in cloud sync.
registerResearchIpc()

// IPC: manage stdio MCP clients + serve their `prompts` catalog to the
// slash-command registry. Renderer pushes desired server specs via
// `mcp:reconcile` whenever the user edits Settings → Extensions.
registerMcpIpc(() => BrowserWindow.getAllWindows())

// Auto-sync helpers. Best-effort on start / quit; failures are logged but
// don't block the app lifecycle. Time caps match the plan:
//   auto-pull on start  → 15 s (one-time hit; bigger cap OK)
//   auto-push on quit   →  10 s (users expect quit to happen fast)
async function runAutoPull(): Promise<void> {
  try {
    const manifest = await readManifest()
    if (!manifest.auto_pull || !manifest.backend || !manifest.remote_url) return
    console.log('[Lattice] auto-pull on start…')
    const res = await Promise.race<unknown>([
      syncPull({ force: false }),
      new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), 15_000)),
    ])
    console.log('[Lattice] auto-pull result:', JSON.stringify(res).slice(0, 200))
  } catch (err) {
    console.warn('[Lattice] auto-pull failed:', (err as Error).message)
  }
}

async function runAutoPush(): Promise<void> {
  try {
    const manifest = await readManifest()
    if (!manifest.auto_push || !manifest.backend || !manifest.remote_url) return
    if (!(await syncHasDirty())) return
    console.log('[Lattice] auto-push on quit…')
    await Promise.race<unknown>([
      syncPush({ force: false }),
      new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), 10_000)),
    ])
  } catch (err) {
    console.warn('[Lattice] auto-push failed:', (err as Error).message)
  }
}

// Force Chromium to resolve `localhost` via IPv4 only. Under WSL, the OS
// resolver can return `::1` (IPv6) first for `localhost`, but uvicorn binds
// `0.0.0.0` (IPv4-only). The renderer's `new WebSocket('ws://localhost:PORT')`
// then connects to `[::1]:PORT` which is refused → close code 1006 → the app
// shows "Backend is not connected" even though the server is perfectly healthy
// on 127.0.0.1. This one-liner eliminates the DNS race entirely.
app.commandLine.appendSwitch('disable-features', 'HappyEyeballsV3')

// WSL2/WSLg fallback: when the GPU process fails to initialize, the
// window opens but no rasterizer paints the React tree → the user sees
// a blank dark-grey window. Setting `LATTICE_DISABLE_GPU=1` forces the
// software path (SwiftShader). Keep it off by default so devs with a
// real GPU don't pay the perf cost. Do NOT also set
// `disable-software-rasterizer` — that kills the only remaining
// rasterizer and the window goes blank again. See BUGFIX_BLANK_WINDOW.md.
if (process.env.LATTICE_DISABLE_GPU === '1') {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu')
}

// App lifecycle
app.whenReady().then(async () => {
  protocol.handle('lattice-pdf', async (request) => {
    const url = new URL(request.url)
    if (url.hostname !== 'paper') {
      return new Response('not found', { status: 404 })
    }
    const idText = url.pathname.replace(/^\/+/, '').trim()
    const resolved = await resolveLibraryPdfPath(idText)
    if (!resolved.ok) {
      return new Response(resolved.error, {
        status: resolved.status ?? 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    }
    return net.fetch(pathToFileURL(resolved.path).toString(), {
      method: request.method,
      headers: request.headers,
    })
  })

  createWindow()

  // Auto-start Python backend
  pythonManager.on('ready', (port, token) => {
    console.log(`[Lattice] Python backend ready on port ${port}`)
    broadcastBackendStatus({ ready: true, port, token })
  })

  pythonManager.on('error', (err) => {
    console.error(`[Lattice] Python backend error: ${err.message}`)
    broadcastBackendStatus({ ready: false, error: err.message })
  })

  pythonManager.on('exit', (code) => {
    console.log(`[Lattice] Python backend exited with code ${code}`)
    broadcastBackendStatus({ ready: false })
  })

  // Auto-start the legacy `lattice-cli` Python backend only when the user
  // explicitly points at a checkout (LATTICE_CLI_PATH). The app itself is
  // self-contained — every UI surface that used to require this backend
  // now has a `local-pro-*` facade (see Self-contained Port Plan §P0–P3).
  // Skipping the spawn keeps cold start fast on machines without a
  // Python environment and avoids a misleading "Python backend error"
  // toast.
  const latticeCliPath = process.env.LATTICE_CLI_PATH
  if (latticeCliPath && latticeCliPath.trim().length > 0) {
    pythonManager
      .start({ latticeCliPath })
      .catch((err) => {
        console.warn(
          `[Lattice] Could not auto-start Python backend: ${err.message}`,
        )
      })
  } else {
    console.log(
      '[Lattice] LATTICE_CLI_PATH not set — skipping legacy Python backend auto-start (app runs self-contained)',
    )
  }

  // Fire-and-forget auto-pull. Renderer hydrates from disk after load, so
  // any pulled content lands in time for the first research-mirror hydrate.
  void runAutoPull()
  restartSyncInterval()
})

let shutdownPromise: Promise<void> | null = null
function shutdownBackends(): Promise<void> {
  if (!shutdownPromise) {
    shutdownPromise = Promise.allSettled([
      pythonManager.stop(),
      getComputeManager()?.cancelAll() ?? Promise.resolve(),
      getWorkerManager()?.stop() ?? Promise.resolve(),
      closeAllWorkspaceWatchers(),
    ]).then(() => undefined)
  }
  return shutdownPromise
}

app.on('window-all-closed', async () => {
  await shutdownBackends()
  app.quit()
})

app.on('before-quit', async () => {
  if (syncIntervalTimer) { clearInterval(syncIntervalTimer); syncIntervalTimer = null }
  await runAutoPush()
  await shutdownAllMcpClients()
  await shutdownBackends()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
