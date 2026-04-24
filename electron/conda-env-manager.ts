// Embedded conda environment manager.
//
// Detects and resolves paths for a conda-pack'd Python + scientific stack
// bundled as `extraResources/conda-env` by electron-builder. Provides a
// fallback chain: embedded conda env → LATTICE_WORKER_PYTHON env var →
// system `python3`.
//
// The conda environment is created offline by `scripts/pack-conda-env.sh`
// and contains: Python 3.12, numpy, scipy, matplotlib, pandas, scikit-learn,
// pymatgen, ase, spglib, phonopy, lammps, rdkit, pdfplumber.
//
// On first launch after install the environment may need a one-time
// `conda-unpack` fixup (conda-pack encodes absolute prefixes into shebangs
// and .pyc files; `conda-unpack` rewrites them for the current location).
// This is idempotent and fast (~2s).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import { execSimple } from './exec-helpers'

let cachedRoot: string | null | undefined
let cachedIsEmbedded = false

function resolveCondaEnvRoot(): string | null {
  if (cachedRoot !== undefined) return cachedRoot

  // Packaged build: process.resourcesPath/conda-env/
  const packed = process.resourcesPath
    ? path.join(process.resourcesPath, 'conda-env')
    : null
  if (packed && hasPython(packed)) {
    cachedRoot = packed
    cachedIsEmbedded = true
    return packed
  }

  // Dev fallback: <repo>/resources/conda-env/
  const devRoot = path.join(app.getAppPath(), 'resources', 'conda-env')
  if (hasPython(devRoot)) {
    cachedRoot = devRoot
    cachedIsEmbedded = true
    return devRoot
  }

  // Dev fallback: well-known conda envs with dara-xrd + scientific stack.
  const home = os.homedir()
  for (const candidate of [
    path.join(home, 'anaconda3', 'envs', 'dara'),
    path.join(home, 'miniconda3', 'envs', 'dara'),
    path.join(home, 'miniforge3', 'envs', 'dara'),
  ]) {
    if (hasPython(candidate)) {
      cachedRoot = candidate
      cachedIsEmbedded = false
      return candidate
    }
  }

  cachedRoot = null
  return null
}

function hasPython(root: string): boolean {
  return (
    fs.existsSync(pythonBin(root)) ||
    fs.existsSync(path.join(root, 'python.exe'))
  )
}

function pythonBin(root: string): string {
  return process.platform === 'win32'
    ? path.join(root, 'python.exe')
    : path.join(root, 'bin', 'python3')
}

export function resolvePython(): string {
  if (process.env.LATTICE_WORKER_PYTHON) {
    return process.env.LATTICE_WORKER_PYTHON
  }
  const root = resolveCondaEnvRoot()
  if (root) return pythonBin(root)
  return process.platform === 'win32' ? 'python' : 'python3'
}

export function resolveLammps(): string | null {
  const root = resolveCondaEnvRoot()
  const candidates: string[] = []
  if (root) {
    candidates.push(
      process.platform === 'win32'
        ? path.join(root, 'Library', 'bin', 'lmp.exe')
        : path.join(root, 'bin', 'lmp'),
    )
  }
  const home = os.homedir()
  for (const envName of ['my-lammps-env', 'lammps', 'dara']) {
    for (const base of ['anaconda3', 'miniconda3', 'miniforge3']) {
      candidates.push(path.join(home, base, 'envs', envName, 'bin', 'lmp'))
    }
  }
  return candidates.find((p) => fs.existsSync(p)) ?? null
}

export function resolveCp2k(): string | null {
  const root = resolveCondaEnvRoot()
  const candidates: string[] = []
  if (root) {
    candidates.push(path.join(root, 'bin', 'cp2k.psmp'))
    candidates.push(path.join(root, 'bin', 'cp2k.popt'))
    candidates.push(path.join(root, 'bin', 'cp2k'))
  }
  const home = os.homedir()
  for (const envName of ['my-lammps-env', 'cp2k', 'dara']) {
    for (const base of ['anaconda3', 'miniconda3', 'miniforge3']) {
      const d = path.join(home, base, 'envs', envName, 'bin')
      candidates.push(path.join(d, 'cp2k.psmp'))
      candidates.push(path.join(d, 'cp2k.popt'))
      candidates.push(path.join(d, 'cp2k'))
    }
  }
  candidates.push('/usr/bin/cp2k.psmp', '/usr/bin/cp2k.popt', '/usr/bin/cp2k')
  return candidates.find((p) => fs.existsSync(p)) ?? null
}

export function isCondaEnvAvailable(): boolean {
  return resolveCondaEnvRoot() !== null
}

export function getCondaEnvRoot(): string | null {
  return resolveCondaEnvRoot()
}

/** Build an env object suitable for `child_process.spawn({ env })` that
 *  puts the conda environment's bin/lib dirs on PATH/LD_LIBRARY_PATH so
 *  native extensions (MKL, OpenBLAS, libgfortran) resolve correctly. */
export function buildCondaSpawnEnv(
  extra?: Record<string, string>,
): Record<string, string> {
  const root = resolveCondaEnvRoot()
  const base: Record<string, string> = { ...process.env } as Record<string, string>

  if (root) {
    const isWin = process.platform === 'win32'
    const binDir = isWin ? root : path.join(root, 'bin')
    const libDir = isWin
      ? path.join(root, 'Library', 'bin')
      : path.join(root, 'lib')

    const pathSep = isWin ? ';' : ':'
    base.PATH = [binDir, libDir, base.PATH ?? ''].filter(Boolean).join(pathSep)

    if (!isWin) {
      base.LD_LIBRARY_PATH = [libDir, base.LD_LIBRARY_PATH ?? '']
        .filter(Boolean)
        .join(':')
    }

    if (cachedIsEmbedded) {
      base.PYTHONHOME = root
      base.PYTHONNOUSERSITE = '1'
    }

    const cp2kData = path.join(root, 'share', 'cp2k', 'data')
    if (fs.existsSync(cp2kData)) {
      base.CP2K_DATA_DIR = cp2kData
    }
  }

  if (extra) Object.assign(base, extra)
  return base
}

/** Write code to a platform-appropriate temp file and return its path.
 *  Caller is responsible for cleanup after the process exits. */
export function writeTempInput(
  code: string,
  prefix: string,
): string {
  const dir = os.tmpdir()
  const name = `_lattice_${prefix}_${Date.now()}.${prefix === 'lammps' ? 'in' : 'inp'}`
  const target = path.join(dir, name)
  fs.writeFileSync(target, code, 'utf8')
  return target
}

/** Remove a temp file, swallowing errors. */
export function cleanupTempInput(filePath: string): void {
  try {
    fs.unlinkSync(filePath)
  } catch {
    // ignore
  }
}

/** Run `conda-unpack` if the marker file doesn't exist yet.
 *  Idempotent — safe to call on every launch. */
export async function ensureCondaUnpacked(): Promise<void> {
  const root = resolveCondaEnvRoot()
  if (!root) return

  const marker = path.join(root, '.lattice-unpacked')
  if (fs.existsSync(marker)) return

  const unpackBin =
    process.platform === 'win32'
      ? path.join(root, 'Scripts', 'conda-unpack.exe')
      : path.join(root, 'bin', 'conda-unpack')

  if (!fs.existsSync(unpackBin)) {
    // No conda-unpack — environment was likely built in-place, not packed.
    try {
      fs.writeFileSync(marker, new Date().toISOString(), 'utf8')
    } catch { /* ignore */ }
    return
  }

  // eslint-disable-next-line no-console
  console.log('[conda-env] Running conda-unpack (first launch)…')
  const result = await execSimple(unpackBin, [], 60_000)
  if (result.code === 0) {
    try {
      fs.writeFileSync(marker, new Date().toISOString(), 'utf8')
    } catch { /* ignore */ }
    // eslint-disable-next-line no-console
    console.log('[conda-env] conda-unpack completed.')
  } else {
    // eslint-disable-next-line no-console
    console.warn(`[conda-env] conda-unpack failed (code ${result.code}): ${result.stderr}`)
  }
}
