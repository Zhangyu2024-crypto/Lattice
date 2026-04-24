// Native compute runner — spawns Python / LAMMPS / CP2K directly in the
// bundled conda environment (see `./conda-env-manager.ts`). Docker-based
// Local/Remote execution was removed in v5; this file is the only
// compute path now.
//
// Concurrency: one active run per `runId`. The renderer generates run
// ids and is responsible for not double-dispatching.
//
// Safety: stdout is captured in full until the process exits, then
// parsed for the figure sentinel. Stderr is streamed in real time so
// long-running progress output is visible before exit. A SIGKILL fires
// on `timeoutSec` timeout.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { BrowserWindow } from 'electron'
import { execPipe } from './exec-helpers'
import { COMPUTE_RUN_CHANNELS } from './compute-constants'
import {
  resolvePython,
  resolveLammps,
  resolveCp2k,
  buildCondaSpawnEnv,
  writeTempInput,
  cleanupTempInput,
} from './conda-env-manager'

export type ComputeMode = 'native' | 'disabled'
export type ComputeLanguage = 'python' | 'lammps' | 'cp2k' | 'shell'

export interface ComputeRunContext {
  /** JSON-serialisable record of active CIF artifacts, exposed to user
   *  code as `ACTIVE_CIFS`. */
  activeCifs?: Record<string, unknown> | null
  /** Currently focused spectrum payload, exposed as `CURRENT_SPECTRUM`. */
  currentSpectrum?: Record<string, unknown> | null
  /** Working directory for the spawned process. Exposed as `WORKDIR`. */
  workdir?: string | null
}

export interface ComputeRunRequest {
  runId: string
  code: string
  language?: ComputeLanguage
  mode: ComputeMode
  timeoutSec: number
  context?: ComputeRunContext
  resources?: {
    cpuCores?: number
    ompThreads?: number | 'auto'
  }
}

export interface ComputeFigurePayload {
  format: 'png' | 'svg'
  base64: string
  caption?: string
}

export type ComputeRunAck =
  | { success: true; runId: string }
  | { success: false; error: string }

export interface ComputeStreamChunk {
  runId: string
  chunk: string
}

export interface ComputeExitEvent {
  runId: string
  exitCode: number | null
  figures: ComputeFigurePayload[]
  durationMs: number
  cancelled: boolean
  error?: string
}

export interface ComputeTestRequest {
  mode: ComputeMode
}

export interface ComputeHealth {
  /** Legacy field name — kept as `container_up` for wire compatibility
   *  with existing renderer consumers. For Native this just means
   *  "the embedded conda env probe succeeded". */
  container_up: boolean
  python_version?: string | null
  packages?: Record<string, string>
  lammps_available?: boolean
  cp2k_available?: boolean
  error?: string | null
}

interface ActiveRun {
  proc: ChildProcessWithoutNullStreams
  cancelled: boolean
  startedAt: number
  stdoutBuf: string
  timeoutHandle: NodeJS.Timeout | null
  tempInputFile: string | null
}

const STREAM_CHANNEL_STDOUT = COMPUTE_RUN_CHANNELS.STDOUT
const STREAM_CHANNEL_STDERR = COMPUTE_RUN_CHANNELS.STDERR
const STREAM_CHANNEL_EXIT = COMPUTE_RUN_CHANNELS.EXIT

// Must match lattice-cli/src/lattice_cli/tools/compute_exec.py:38.
const FIGURE_SENTINEL = '__LATTICE_FIGURES__'

const HEALTH_CACHE_TTL_MS = 15_000
const DEFAULT_LANGUAGE: ComputeLanguage = 'python'
const SUPPORTED_LANGUAGES: readonly ComputeLanguage[] = [
  'python',
  'lammps',
  'cp2k',
]

// Ported verbatim from lattice-cli/src/lattice_cli/tools/compute_exec.py:51-100.
// Keep the string in lock-step with upstream — the Agg backend + plt.show
// monkey-patch + atexit figure emission are what the renderer depends on.
const PYTHON_HEADER = `# -- Auto-injected by lattice-app compute runner --
import sys as _sys, os as _os, json as _json, io as _io, base64 as _base64
import atexit as _atexit

try:
    import matplotlib as _mpl
    _mpl.use("Agg")
    import matplotlib.pyplot as _plt
except Exception:
    _plt = None

_FIGURES = []

def _capture_figures():
    if _plt is None:
        return
    try:
        for _fn in _plt.get_fignums():
            _buf = _io.BytesIO()
            _plt.figure(_fn).savefig(_buf, format="png", dpi=110, bbox_inches="tight")
            _FIGURES.append(_base64.b64encode(_buf.getvalue()).decode("ascii"))
        _plt.close("all")
    except Exception as _exc:
        _sys.stderr.write(f"[lattice] figure capture failed: {_exc}\\n")

def _emit_figures():
    _capture_figures()
    if _FIGURES:
        _sys.stdout.write("\\n" + "__LATTICE_FIGURES__" + _json.dumps(_FIGURES) + "\\n")
        _sys.stdout.flush()

_atexit.register(_emit_figures)

ACTIVE_CIFS = _json.loads(_os.environ.get("LATTICE_ACTIVE_CIFS", "{}"))
CURRENT_SPECTRUM = _json.loads(_os.environ.get("LATTICE_CURRENT_SPECTRUM", "null"))
WORKDIR = _os.environ.get("LATTICE_WORKDIR", "/tmp")

def load_structure(key=None):
    """Return a pymatgen Structure for a session structure.

    load_structure() with no args returns the first CIF in ACTIVE_CIFS,
    raising a clear SystemExit if the session has none.
    load_structure('Fe3O4') matches by key or formula (case-insensitive).
    The CIFs come from session structure artifacts + built structure cells.
    """
    try:
        from pymatgen.core import Structure as _Structure
    except Exception as _exc:
        raise SystemExit(f"load_structure() needs pymatgen: {_exc}")
    if not ACTIVE_CIFS:
        raise SystemExit("No structures in session. Build a structure cell first, or drop a .cif into the workspace.")
    if key is None:
        entry = next(iter(ACTIVE_CIFS.values()))
    else:
        needle = str(key).lower()
        entry = None
        for _k, _v in ACTIVE_CIFS.items():
            if _k.lower() == needle:
                entry = _v
                break
            if isinstance(_v, dict):
                _formula = str(_v.get("formula", "")).lower()
                if _formula == needle:
                    entry = _v
                    break
        if entry is None:
            raise SystemExit(f"load_structure: no structure matched '{key}'. Known keys: {list(ACTIVE_CIFS.keys())}")
    if isinstance(entry, dict):
        _cif = entry.get("cif_text") or entry.get("cif")
    else:
        _cif = entry
    if not _cif:
        raise SystemExit(f"load_structure: entry for '{key}' has no CIF text")
    return _Structure.from_str(str(_cif), fmt="cif")

if _plt is not None:
    def _show_intercept(*args, **kwargs):
        _capture_figures()
    _plt.show = _show_intercept

# -- User code below --
`

// Probe script run by the embedded Python to collect installed package
// versions. Mirrors lattice-cli compute_exec.py:907-919.
const HEALTH_PROBE_SCRIPT = `import sys, importlib, shutil
print(sys.version.split()[0])
for pkg in ['numpy','scipy','matplotlib','pandas','pymatgen','ase','spglib','phonopy','lammps','MDAnalysis','mp_api']:
    try:
        m = importlib.import_module(pkg)
        print(pkg+'='+getattr(m,'__version__','?'))
    except Exception:
        pass
print('lammps_bin=' + ('yes' if shutil.which('lmp') else 'no'))
print('cp2k_bin=' + ('yes' if shutil.which('cp2k') else 'no'))
`

export class ComputeRunnerManager {
  private runs = new Map<string, ActiveRun>()
  private getWindow: () => BrowserWindow | null

  private healthCache: {
    at: number
    result: ComputeHealth
  } | null = null

  constructor(getWindow: () => BrowserWindow | null) {
    this.getWindow = getWindow
  }

  /** Number of in-flight processes — for diagnostics. */
  get activeCount(): number {
    return this.runs.size
  }

  /** Probe the embedded conda env. Results cache for 15s unless `force`. */
  async testConnection(
    req: ComputeTestRequest,
    opts: { force?: boolean } = {},
  ): Promise<ComputeHealth> {
    if (req.mode === 'disabled') {
      return {
        container_up: false,
        error: 'Compute is disabled in Settings → Compute Environment.',
      }
    }

    const now = Date.now()
    if (
      !opts.force &&
      this.healthCache &&
      now - this.healthCache.at < HEALTH_CACHE_TTL_MS
    ) {
      return this.healthCache.result
    }
    const result = await this.probeNativeHealth()
    this.healthCache = { at: Date.now(), result }
    return result
  }

  /** Execute user code in the embedded conda env. Streams stdout/stderr
   *  back via IPC and emits a `compute:exit` event with captured figures. */
  async run(req: ComputeRunRequest): Promise<ComputeRunAck> {
    if (req.mode === 'disabled') {
      return { success: false, error: 'Compute is disabled in Settings → Compute Environment.' }
    }
    if (!req.code || !req.code.trim()) {
      return { success: false, error: 'Empty code.' }
    }
    if (this.runs.has(req.runId)) {
      return { success: false, error: `runId ${req.runId} already active` }
    }

    const language = (req.language ?? DEFAULT_LANGUAGE) as ComputeLanguage
    if (!SUPPORTED_LANGUAGES.includes(language)) {
      return {
        success: false,
        error: `Unsupported language: ${language}. Supported: ${SUPPORTED_LANGUAGES.join(', ')}.`,
      }
    }

    const ctx = req.context ?? {}
    const workdir = (ctx.workdir && ctx.workdir.trim()) || os.tmpdir()
    const nativeEnv = buildCondaSpawnEnv(buildNativeEnvRecord(ctx, req.resources))

    let proc: ChildProcessWithoutNullStreams
    let payload: string
    let tempInputFile: string | null = null

    if (language === 'python') {
      payload = PYTHON_HEADER + req.code + '\n'
      try {
        proc = spawn(resolvePython(), ['-u', '-'], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: nativeEnv,
          cwd: workdir,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, error: `Failed to spawn python: ${message}` }
      }
    } else if (language === 'lammps') {
      const lmp = resolveLammps()
      if (!lmp) {
        return {
          success: false,
          error: 'LAMMPS binary not found in embedded environment. Rebuild the bundled conda env.',
        }
      }
      tempInputFile = writeTempInput(req.code, 'lammps')
      payload = ''
      try {
        proc = spawn(lmp, ['-in', tempInputFile, '-log', 'none'], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: nativeEnv,
          cwd: workdir,
        })
      } catch (err) {
        cleanupTempInput(tempInputFile)
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, error: `Failed to spawn lammps: ${message}` }
      }
    } else if (language === 'cp2k') {
      const cp2kBin = resolveCp2k()
      if (!cp2kBin) {
        return {
          success: false,
          error: 'CP2K binary not found in embedded environment. Install via conda (conda install -c conda-forge cp2k) or rebuild the bundled env.',
        }
      }
      const cp2kEnv = { ...nativeEnv }
      const cp2kRoot = path.resolve(cp2kBin, '..', '..')
      const cp2kData = path.join(cp2kRoot, 'share', 'cp2k', 'data')
      if (fs.existsSync(cp2kData)) cp2kEnv.CP2K_DATA_DIR = cp2kData
      const mpirun = path.join(path.dirname(cp2kBin), 'mpirun')
      const usesMpi = fs.existsSync(mpirun)
      tempInputFile = writeTempInput(req.code, 'cp2k')
      payload = ''
      const cp2kArgs = usesMpi
        ? [mpirun, '--oversubscribe', '-np', '1', cp2kBin, '-i', tempInputFile]
        : [cp2kBin, '-i', tempInputFile]
      try {
        proc = spawn(cp2kArgs[0], cp2kArgs.slice(1), {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: cp2kEnv,
          cwd: workdir,
        })
      } catch (err) {
        if (tempInputFile) cleanupTempInput(tempInputFile)
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, error: `Failed to spawn cp2k: ${message}` }
      }
    } else {
      return { success: false, error: `Unsupported language: ${language}` }
    }

    const active: ActiveRun = {
      proc,
      cancelled: false,
      startedAt: Date.now(),
      stdoutBuf: '',
      timeoutHandle: null,
      tempInputFile,
    }
    this.runs.set(req.runId, active)

    // Buffer stdout so we can scan for the figure sentinel on exit,
    // but stream it to the renderer as it arrives so live `print()`
    // output is visible in real time.
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => {
      active.stdoutBuf += chunk
      const msg: ComputeStreamChunk = { runId: req.runId, chunk }
      this.getWindow()?.webContents.send(STREAM_CHANNEL_STDOUT, msg)
    })

    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (chunk: string) => {
      const msg: ComputeStreamChunk = { runId: req.runId, chunk }
      this.getWindow()?.webContents.send(STREAM_CHANNEL_STDERR, msg)
    })

    proc.on('error', (err) => {
      const msg: ComputeStreamChunk = {
        runId: req.runId,
        chunk: `\n[spawn error] ${err.message}\n`,
      }
      this.getWindow()?.webContents.send(STREAM_CHANNEL_STDERR, msg)
    })

    proc.on('exit', (exitCode) => {
      if (active.timeoutHandle) clearTimeout(active.timeoutHandle)
      if (active.tempInputFile) cleanupTempInput(active.tempInputFile)
      const { figures } = parseFigures(active.stdoutBuf, language === 'python')
      const exit: ComputeExitEvent = {
        runId: req.runId,
        exitCode,
        figures,
        durationMs: Date.now() - active.startedAt,
        cancelled: active.cancelled,
      }
      this.getWindow()?.webContents.send(STREAM_CHANNEL_EXIT, exit)
      this.runs.delete(req.runId)
    })

    active.timeoutHandle = setTimeout(() => {
      if (!this.runs.has(req.runId)) return
      active.cancelled = true
      try {
        proc.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }, req.timeoutSec * 1000)

    try {
      proc.stdin.write(payload, 'utf8')
      proc.stdin.end()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      active.cancelled = true
      try {
        proc.kill('SIGKILL')
      } catch {
        /* already gone */
      }
      return { success: false, error: `Failed to send code to process: ${message}` }
    }

    return { success: true, runId: req.runId }
  }

  /** SIGKILL an in-flight run. Exit handler emits the close event. */
  async cancel(runId: string): Promise<{ success: boolean }> {
    const active = this.runs.get(runId)
    if (!active) return { success: false }
    active.cancelled = true
    try {
      active.proc.kill('SIGKILL')
    } catch {
      /* already gone */
    }
    return { success: true }
  }

  /** Cancel everything; called from app.before-quit in main.ts. */
  async cancelAll(): Promise<void> {
    const ids = Array.from(this.runs.keys())
    await Promise.all(ids.map((id) => this.cancel(id)))
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private async probeNativeHealth(): Promise<ComputeHealth> {
    const python = resolvePython()
    const probe = await execPipe(python, ['-u', '-'], HEALTH_PROBE_SCRIPT, 15_000)
    if (probe.code !== 0) {
      return {
        container_up: false,
        error: `Native Python probe failed: ${probe.stderr.trim() || `exit ${probe.code}`}`,
      }
    }

    const lines = probe.stdout.split('\n').filter((l) => l.length > 0)
    const packages: Record<string, string> = {}
    let pythonVersion: string | null = null
    let lammpsAvailable = false
    if (lines.length > 0) {
      pythonVersion = lines[0].trim()
      for (const line of lines.slice(1)) {
        const eq = line.indexOf('=')
        if (eq < 0) continue
        const key = line.slice(0, eq)
        const value = line.slice(eq + 1)
        if (key === 'lammps_bin') {
          lammpsAvailable = value === 'yes'
        } else if (key === 'cp2k_bin') {
          // parsed below via resolveCp2k
        } else {
          packages[key] = value
        }
      }
    }
    if (!lammpsAvailable && resolveLammps()) lammpsAvailable = true
    const cp2kAvailableNative = !!resolveCp2k()

    return {
      container_up: true,
      python_version: pythonVersion,
      packages,
      lammps_available: lammpsAvailable,
      cp2k_available: cp2kAvailableNative,
      error: null,
    }
  }
}

function buildNativeEnvRecord(
  ctx: ComputeRunContext,
  resources?: ComputeRunRequest['resources'],
): Record<string, string> {
  const cpus = resources?.cpuCores ?? os.cpus().length
  const threads =
    resources?.ompThreads === 'auto' || resources?.ompThreads == null
      ? cpus
      : resources.ompThreads
  const t = String(threads)
  return {
    LATTICE_ACTIVE_CIFS: JSON.stringify(ctx.activeCifs ?? {}),
    LATTICE_CURRENT_SPECTRUM: JSON.stringify(ctx.currentSpectrum ?? null),
    LATTICE_WORKDIR: (ctx.workdir && ctx.workdir.trim()) || os.tmpdir(),
    PYTHONUNBUFFERED: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    OMP_NUM_THREADS: t,
    MKL_NUM_THREADS: t,
    OPENBLAS_NUM_THREADS: t,
    NUMEXPR_MAX_THREADS: t,
  }
}

// Split stdout into user-visible text + captured figure list.
// Handles the case where user code happens to `print('__LATTICE_FIGURES__…')`:
// we take the LAST occurrence and require the tail to be a valid JSON array.
// On failure, return the original text untouched + no figures (same
// forgiveness as lattice-cli's _parse_output).
function parseFigures(
  stdout: string,
  pythonMode: boolean,
): { stdoutVisible: string; figures: ComputeFigurePayload[] } {
  if (!pythonMode || !stdout.includes(FIGURE_SENTINEL)) {
    return { stdoutVisible: stdout, figures: [] }
  }
  const idx = stdout.lastIndexOf(FIGURE_SENTINEL)
  const head = stdout.slice(0, idx).replace(/\n$/, '')
  const tailWhole = stdout.slice(idx + FIGURE_SENTINEL.length)
  const tailLine = tailWhole.split('\n', 1)[0].trim()
  try {
    const parsed = JSON.parse(tailLine)
    if (!Array.isArray(parsed)) {
      return { stdoutVisible: stdout, figures: [] }
    }
    const figures: ComputeFigurePayload[] = []
    parsed.forEach((b64, i) => {
      if (typeof b64 === 'string' && b64.length > 0) {
        figures.push({
          format: 'png',
          base64: b64,
          caption: `fig_${String(i + 1).padStart(2, '0')}.png`,
        })
      }
    })
    return { stdoutVisible: head, figures }
  } catch {
    return { stdoutVisible: stdout, figures: [] }
  }
}
