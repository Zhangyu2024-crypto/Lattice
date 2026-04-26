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
import { app, type BrowserWindow } from 'electron'
import { execPipe } from './exec-helpers'
import { COMPUTE_RUN_CHANNELS } from './compute-constants'
import { getCurrentWorkspaceRoot, getCurrentWorkspaceRootLoaded } from './ipc-workspace-root'
import {
  resolvePython,
  resolveLammps,
  resolveCp2k,
  buildCondaSpawnEnv,
  writeTempInput,
  cleanupTempInput,
} from './conda-env-manager'

// Per-artifact workdir retention. Runs older than this many are pruned
// from disk on the next run. The metadata entry stays in the artifact's
// `runs[]` until that's explicitly trimmed UI-side.
const KEEP_RUNS_PER_ARTIFACT = 3
const WORKSPACE_COMPUTE_RUNS_REL = path.join('lattice-runs', 'compute')
const LEGACY_COMPUTE_RUNS_REL = path.join('workspace', 'compute')

function sanitizePathSegment(s: string): string {
  // Session IDs / artifact IDs can contain '/', ':', etc. Keep the shape
  // human-readable but path-safe.
  return s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'unknown'
}

function formatTimestampForFilename(d: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}

function legacyComputeWorkspaceRoot(): string {
  return path.join(app.getPath('userData'), ...LEGACY_COMPUTE_RUNS_REL.split(path.sep))
}

/** Root for archived compute runs. Prefer the user-selected workspace so
 *  process files are visible and portable with the project. Fall back to the
 *  legacy Electron userData directory when no workspace is open yet. */
async function computeWorkspaceRoot(): Promise<{ root: string; workspaceRoot: string | null }> {
  const workspaceRoot = await getCurrentWorkspaceRootLoaded()
  if (workspaceRoot) {
    return {
      root: path.join(workspaceRoot, ...WORKSPACE_COMPUTE_RUNS_REL.split(path.sep)),
      workspaceRoot,
    }
  }
  return { root: legacyComputeWorkspaceRoot(), workspaceRoot: null }
}

function datePathSegment(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function workspaceRelativePath(workspaceRoot: string | null, absPath: string): string | null {
  if (!workspaceRoot) return null
  const rel = path.relative(workspaceRoot, absPath)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  return rel.split(path.sep).join('/')
}

async function allocateRunWorkdir(
  sessionId: string,
  artifactId: string,
  runId: string,
  startedAt: Date,
): Promise<{ workdir: string; workspaceRoot: string | null; workspaceRelPath: string | null }> {
  const { root, workspaceRoot } = await computeWorkspaceRoot()
  const sid = sanitizePathSegment(sessionId)
  const aid = sanitizePathSegment(artifactId)
  const ts = formatTimestampForFilename(startedAt)
  const tail = runId.slice(-6)
  const dir = path.join(
    root,
    datePathSegment(startedAt),
    sid,
    aid,
    `run_${ts}_${tail}`,
  )
  fs.mkdirSync(dir, { recursive: true })
  return {
    workdir: dir,
    workspaceRoot,
    workspaceRelPath: workspaceRelativePath(workspaceRoot, dir),
  }
}

function collectRunDirs(root: string, artifactId: string): Array<{ path: string; mtimeMs: number }> {
  const aid = sanitizePathSegment(artifactId)
  const out: Array<{ path: string; mtimeMs: number }> = []
  const visit = (dir: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const child = path.join(dir, entry.name)
      if (entry.name === aid) {
        try {
          for (const run of fs.readdirSync(child, { withFileTypes: true })) {
            if (!run.isDirectory() || !run.name.startsWith('run_')) continue
            const runPath = path.join(child, run.name)
            out.push({ path: runPath, mtimeMs: fs.statSync(runPath).mtimeMs })
          }
        } catch {
          /* skip unreadable artifact dir */
        }
        continue
      }
      visit(child)
    }
  }
  visit(root)
  return out
}

/** Prune older workdirs for the same artifact so disk usage stays bounded.
 *  Keeps the `KEEP_RUNS_PER_ARTIFACT` most recent across date folders. */
async function pruneArtifactWorkdirs(artifactId: string): Promise<void> {
  try {
    const { root } = await computeWorkspaceRoot()
    const entries = collectRunDirs(root, artifactId)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
    for (const stale of entries.slice(KEEP_RUNS_PER_ARTIFACT)) {
      fs.rmSync(stale.path, { recursive: true, force: true })
    }
  } catch {
    /* best effort */
  }
}

export function computeArchiveRoots(): string[] {
  const roots = [legacyComputeWorkspaceRoot()]
  const workspaceRoot = getCurrentWorkspaceRoot()
  if (workspaceRoot) roots.unshift(path.join(workspaceRoot, ...WORKSPACE_COMPUTE_RUNS_REL.split(path.sep)))
  return Array.from(new Set(roots.map((root) => path.resolve(root))))
}

const SCRIPT_FILENAME_BY_LANG: Record<ComputeLanguage, string> = {
  python: 'script.py',
  cp2k: 'input.inp',
  lammps: 'input.in',
  shell: 'script.sh',
}

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
  /** Session + artifact identifiers so the runner can archive this run
   *  under `<workspace>/lattice-runs/compute/<date>/<sid>/<aid>/run_.../`.
   *  When no workspace is open, it falls back to the legacy userData
   *  archive; when either ID is absent, it uses os.tmpdir(). */
  sessionId?: string
  artifactId?: string
}

export interface ComputeFigurePayload {
  format: 'png' | 'svg'
  base64: string
  caption?: string
}

export type ComputeRunAck =
  | { success: true; runId: string; workdir?: string }
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
  timedOut?: boolean
  error?: string
  /** Absolute path to this run's archived workdir (script, stdout.log,
   *  stderr.log, meta.json, plus anything the script wrote under
   *  LATTICE_WORKDIR). Absent when archival was skipped. */
  workdir?: string
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
  timedOut: boolean
  startedAt: number
  startedAtIso: string
  stdoutBuf: string
  timeoutHandle: NodeJS.Timeout | null
  tempInputFile: string | null
  /** When present, this run is archived to disk. Streams below mirror
   *  stdout/stderr to `stdout.log` / `stderr.log` inside the workdir. */
  workdir: string | null
  workspaceRoot: string | null
  workspaceRelPath: string | null
  stdoutFile: fs.WriteStream | null
  stderrFile: fs.WriteStream | null
  language: ComputeLanguage
  sessionId: string | null
  artifactId: string | null
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

def lattice_progress(current, total):
    """Emit a progress marker the UI parses into a progress bar.

    Usage inside a compute script::

        for i, strain in enumerate(strains):
            lattice_progress(i + 1, len(strains))
            run_cp2k(strain)
    """
    _sys.stdout.write(f"__LATTICE_PROGRESS__ {int(current)}/{int(total)}\\n")
    _sys.stdout.flush()

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

    // Decide between "archived" mode (sessionId + artifactId supplied →
    // per-run workdir under the workspace archive, retained with a short
    // history) and back-compat tmpdir mode. Archiving is the default for
    // UI-triggered runs; programmatic back-compat callers fall through to
    // os.tmpdir().
    let archivedWorkdir: string | null = null
    let archiveWorkspaceRoot: string | null = null
    let archiveWorkspaceRelPath: string | null = null
    const startedDate = new Date()
    if (req.sessionId && req.artifactId) {
      try {
        const allocated = await allocateRunWorkdir(
          req.sessionId,
          req.artifactId,
          req.runId,
          startedDate,
        )
        archivedWorkdir = allocated.workdir
        archiveWorkspaceRoot = allocated.workspaceRoot
        archiveWorkspaceRelPath = allocated.workspaceRelPath
        // Prune older runs for the same artifact after the new one is
        // allocated — ordering matters so we never delete the slot we
        // just created.
        await pruneArtifactWorkdirs(req.artifactId)
      } catch (err) {
        // Archival failure must not block the run; log and fall through.
        const msg = err instanceof Error ? err.message : String(err)
        this.getWindow()?.webContents.send(STREAM_CHANNEL_STDERR, {
          runId: req.runId,
          chunk: `[lattice] could not allocate workdir (${msg}); running without archival\n`,
        })
        archivedWorkdir = null
      }
    }
    const workdir =
      archivedWorkdir ?? ((ctx.workdir && ctx.workdir.trim()) || os.tmpdir())

    const nativeEnv = buildCondaSpawnEnv(
      buildNativeEnvRecord({ ...ctx, workdir }, req.resources),
    )

    // Persist the script into the workdir so a user browsing the
    // archived directory later can re-run exactly what the subprocess
    // saw — the agent's in-canvas copy can drift or be edited afterward.
    if (archivedWorkdir) {
      const scriptFilename = SCRIPT_FILENAME_BY_LANG[language] ?? 'script.txt'
      try {
        fs.writeFileSync(path.join(archivedWorkdir, scriptFilename), req.code, 'utf8')
      } catch {
        /* non-fatal */
      }
    }

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
      // Conda CP2K often ships as `cp2k.psmp` (MPI+OpenMP). Launching it
      // through `mpirun -np 1` is fragile on WSL / sandboxed desktops
      // because PMIx/UCX tries to open host networking sockets even for a
      // single rank. Running the binary directly still gives one MPI rank
      // and honors OMP_NUM_THREADS. These OpenMPI defaults also keep direct
      // `cp2k.psmp` away from unavailable high-performance transports.
      cp2kEnv.OMPI_MCA_btl = cp2kEnv.OMPI_MCA_btl ?? 'self'
      cp2kEnv.OMPI_MCA_pml = cp2kEnv.OMPI_MCA_pml ?? 'ob1'
      cp2kEnv.OMPI_MCA_rmaps_base_oversubscribe =
        cp2kEnv.OMPI_MCA_rmaps_base_oversubscribe ?? '1'
      const cp2kRoot = path.resolve(cp2kBin, '..', '..')
      const cp2kData = path.join(cp2kRoot, 'share', 'cp2k', 'data')
      if (fs.existsSync(cp2kData)) cp2kEnv.CP2K_DATA_DIR = cp2kData
      tempInputFile = writeTempInput(req.code, 'cp2k')
      payload = ''
      const cp2kArgs = [cp2kBin, '-i', tempInputFile]
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

    // Open log files inside the archived workdir. stdout is double-written
    // (both streamed to renderer for live display AND persisted here for
    // later browsing). We intentionally persist the *raw* stdout including
    // the figure sentinel — debuggability beats prettiness.
    let stdoutFile: fs.WriteStream | null = null
    let stderrFile: fs.WriteStream | null = null
    if (archivedWorkdir) {
      try {
        stdoutFile = fs.createWriteStream(
          path.join(archivedWorkdir, 'stdout.log'),
        )
        stderrFile = fs.createWriteStream(
          path.join(archivedWorkdir, 'stderr.log'),
        )
      } catch {
        stdoutFile?.close()
        stderrFile?.close()
        stdoutFile = null
        stderrFile = null
      }
    }

    const active: ActiveRun = {
      proc,
      cancelled: false,
      timedOut: false,
      startedAt: startedDate.getTime(),
      startedAtIso: startedDate.toISOString(),
      stdoutBuf: '',
      timeoutHandle: null,
      tempInputFile,
      workdir: archivedWorkdir,
      workspaceRoot: archiveWorkspaceRoot,
      workspaceRelPath: archiveWorkspaceRelPath,
      stdoutFile,
      stderrFile,
      language,
      sessionId: req.sessionId ?? null,
      artifactId: req.artifactId ?? null,
    }
    this.runs.set(req.runId, active)

    // Buffer stdout so we can scan for the figure sentinel on exit,
    // but stream it to the renderer as it arrives so live `print()`
    // output is visible in real time. When archiving, also mirror each
    // chunk into stdout.log / stderr.log.
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => {
      active.stdoutBuf += chunk
      active.stdoutFile?.write(chunk)
      const msg: ComputeStreamChunk = { runId: req.runId, chunk }
      this.getWindow()?.webContents.send(STREAM_CHANNEL_STDOUT, msg)
    })

    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (chunk: string) => {
      active.stderrFile?.write(chunk)
      const msg: ComputeStreamChunk = { runId: req.runId, chunk }
      this.getWindow()?.webContents.send(STREAM_CHANNEL_STDERR, msg)
    })

    proc.on('error', (err) => {
      const note = `\n[spawn error] ${err.message}\n`
      active.stderrFile?.write(note)
      const msg: ComputeStreamChunk = { runId: req.runId, chunk: note }
      this.getWindow()?.webContents.send(STREAM_CHANNEL_STDERR, msg)
    })

    proc.on('exit', (exitCode) => {
      if (active.timeoutHandle) clearTimeout(active.timeoutHandle)
      if (active.tempInputFile) cleanupTempInput(active.tempInputFile)
      const finishedAt = Date.now()
      const durationMs = finishedAt - active.startedAt
      const { figures } = parseFigures(active.stdoutBuf, language === 'python')
      // Close log files before writing meta.json so readers see complete
      // logs and the meta file as a finalization marker.
      active.stdoutFile?.end()
      active.stderrFile?.end()
      active.stdoutFile = null
      active.stderrFile = null
      if (active.workdir) {
        try {
          const meta = {
            runId: req.runId,
            sessionId: active.sessionId,
            artifactId: active.artifactId,
            language: active.language,
            startedAt: active.startedAtIso,
            finishedAt: new Date(finishedAt).toISOString(),
            durationMs,
            exitCode,
            cancelled: active.cancelled,
            timedOut: active.timedOut,
            figureCount: figures.length,
            workdir: active.workdir,
            workspaceRoot: active.workspaceRoot,
            workspaceRelPath: active.workspaceRelPath,
          }
          fs.writeFileSync(
            path.join(active.workdir, 'meta.json'),
            JSON.stringify(meta, null, 2),
            'utf8',
          )
        } catch {
          /* best effort */
        }
      }
      const exit: ComputeExitEvent = {
        runId: req.runId,
        exitCode,
        figures,
        durationMs,
        cancelled: active.cancelled,
        ...(active.timedOut ? { timedOut: true } : {}),
        ...(active.workdir ? { workdir: active.workdir } : {}),
      }
      this.getWindow()?.webContents.send(STREAM_CHANNEL_EXIT, exit)
      this.runs.delete(req.runId)
    })

    active.timeoutHandle = setTimeout(() => {
      if (!this.runs.has(req.runId)) return
      active.cancelled = true
      active.timedOut = true
      const note = `\n[lattice] compute timed out after ${req.timeoutSec}s; killing process\n`
      active.stderrFile?.write(note)
      this.getWindow()?.webContents.send(STREAM_CHANNEL_STDERR, {
        runId: req.runId,
        chunk: note,
      })
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

    return {
      success: true,
      runId: req.runId,
      ...(archivedWorkdir ? { workdir: archivedWorkdir } : {}),
    }
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
