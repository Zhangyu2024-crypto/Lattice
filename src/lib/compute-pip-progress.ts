// Parser for pip's stdout + stderr streams to extract per-package
// progress during an install / upgrade (PM3). pip's CLI output over
// the lifetime of one run looks roughly like:
//
//   Collecting rdkit
//     Downloading rdkit-2024.9.4-cp312-cp312-manylinux_2_28_x86_64.whl (34.5 MB)
//        ━━━━━━━━━━━━━━━━━━━━━━━ 14.2/34.5 MB 2.1 MB/s eta 0:00:10
//   Installing collected packages: rdkit
//   Successfully installed rdkit-2024.9.4
//
// We stream each chunk through the parser; callers render the
// aggregate state. Once `state.phase === 'installing'` or `'done'` the
// bar locks at 100% so jitter doesn't surprise the user.

export type PhaseName = 'idle' | 'collecting' | 'downloading' | 'installing' | 'done' | 'error'

export interface PackageProgress {
  /** The package currently being worked on, or "" before the first Collecting line. */
  name: string
  phase: PhaseName
  downloadedMB: number
  totalMB: number
  speed?: string
  eta?: string
  /** Free-form bottom message; usually the most recent status line. */
  message: string
}

export const EMPTY_PROGRESS: PackageProgress = {
  name: '',
  phase: 'idle',
  downloadedMB: 0,
  totalMB: 0,
  message: '',
}

const COLLECTING_RE = /^\s*Collecting\s+([\w\-\.\[\]]+)/
const DOWNLOADING_RE = /Downloading\s+([^\s]+)\s+\(([\d.]+)\s*([KMG]?)B\)/i
const PROGRESS_RE = /([\d.]+)\s*\/\s*([\d.]+)\s*([KMG]?)B\s+([\d.]+\s*[KMG]?B\/s)\s+eta\s+(\d+:\d+(?::\d+)?)/i
const INSTALLING_RE = /^\s*Installing collected packages:/
const SUCCESS_RE = /^\s*Successfully installed/
const FAILURE_RE = /^\s*ERROR:|Could not install/i

export function reduceProgress(
  prev: PackageProgress,
  chunk: string,
): PackageProgress {
  // A single chunk may contain multiple newlines — also handle the
  // carriage-return progress updates from pip's Rich-style bar which
  // overwrite the same line. Split on both \n and \r so we catch the
  // intermediate updates.
  const lines = chunk.split(/[\r\n]+/).filter((l) => l.trim().length > 0)
  let next = prev
  for (const raw of lines) {
    const line = raw.trim()
    next = reduceLine(next, line)
  }
  return next
}

function reduceLine(prev: PackageProgress, line: string): PackageProgress {
  const collecting = COLLECTING_RE.exec(line)
  if (collecting) {
    return {
      ...prev,
      name: collecting[1],
      phase: 'collecting',
      downloadedMB: 0,
      totalMB: 0,
      message: line,
      speed: undefined,
      eta: undefined,
    }
  }

  const downloading = DOWNLOADING_RE.exec(line)
  if (downloading) {
    const total = toMB(Number(downloading[2]), downloading[3])
    return {
      ...prev,
      phase: 'downloading',
      totalMB: total,
      message: line,
    }
  }

  const prog = PROGRESS_RE.exec(line)
  if (prog) {
    const done = toMB(Number(prog[1]), prog[3])
    const total = toMB(Number(prog[2]), prog[3])
    return {
      ...prev,
      phase: 'downloading',
      downloadedMB: done,
      totalMB: total,
      speed: prog[4],
      eta: prog[5],
      message: line,
    }
  }

  if (INSTALLING_RE.test(line)) {
    return {
      ...prev,
      phase: 'installing',
      downloadedMB: prev.totalMB,
      message: line,
    }
  }

  if (SUCCESS_RE.test(line)) {
    return {
      ...prev,
      phase: 'done',
      message: line,
      downloadedMB: prev.totalMB,
    }
  }

  if (FAILURE_RE.test(line)) {
    return {
      ...prev,
      phase: 'error',
      message: line,
    }
  }

  // Don't clobber last-known good state on informational lines.
  return { ...prev, message: line }
}

function toMB(value: number, unit: string): number {
  switch (unit.toUpperCase()) {
    case 'K':
      return value / 1024
    case 'G':
      return value * 1024
    case 'M':
    default:
      return value
  }
}
