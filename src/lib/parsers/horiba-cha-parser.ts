// Horiba LabSpec CHA Raman binary parser — ported from
// lattice-cli/src/lattice_cli/readers/native_readers.py (load_horiba_cha).
//
// The CHA format has no public specification; this parser is a
// heuristic, reverse-engineered reader that tries multiple header
// layouts in order:
//   1) Structured header: uint32 n_points, optional float64 start_wn +
//      float64 step_wn, then float64 / float32 data.
//   2) Fixed-size header (64 / 128 / 256 / 512 / 1024 bytes) followed
//      by a raw float64 or float32 data block.
// All integers and floats are little-endian.

import type { ParsedSpectrum } from './types'

const HEADER_SCAN_BYTES = 512
const MIN_POINTS = 10
const MAX_POINTS = 100_000
const FIXED_HEADER_SIZES = [64, 128, 256, 512, 1024]

interface ParseAttempt {
  x: number[]
  y: number[]
  xLabel: string
  parseMethod: string
}

export function parseHoribaCha(
  buffer: ArrayBuffer,
  sourceFile: string,
): ParsedSpectrum | null {
  const data = new Uint8Array(buffer)
  if (data.length < 16) return null

  try {
    const structured = tryChaStructured(data)
    if (structured) return toSpectrum(structured, sourceFile)

    const block = tryChaFloatBlock(data)
    if (block) return toSpectrum(block, sourceFile)
  } catch {
    return null
  }

  return null
}

// ── Strategy 1: header scan ─────────────────────────────────────

function tryChaStructured(data: Uint8Array): ParseAttempt | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const fileSize = data.length
  const scanLimit = Math.min(HEADER_SCAN_BYTES, fileSize - 4)

  for (let headerOffset = 0; headerOffset < scanLimit; headerOffset += 4) {
    const nPoints = view.getUint32(headerOffset, true)
    if (nPoints < MIN_POINTS || nPoints > MAX_POINTS) continue

    const dataStart = headerOffset + 4

    // 1a) float64 data immediately after n_points, consuming the rest
    const sizeF64 = nPoints * 8
    if (dataStart + sizeF64 === fileSize) {
      const y = readFloat64Array(view, dataStart, nPoints)
      if (validateSpectralData(y)) {
        return {
          x: indexAxis(nPoints),
          y,
          xLabel: 'Index',
          parseMethod: `structured_f64_offset_${headerOffset}`,
        }
      }
    }

    // 1b) float32 data immediately after n_points, consuming the rest
    const sizeF32 = nPoints * 4
    if (dataStart + sizeF32 === fileSize) {
      const y = readFloat32Array(view, dataStart, nPoints)
      if (validateSpectralData(y)) {
        return {
          x: indexAxis(nPoints),
          y,
          xLabel: 'Index',
          parseMethod: `structured_f32_offset_${headerOffset}`,
        }
      }
    }

    // 1c) wavenumber calibration (start_wn + step_wn) + float64 data
    const calibStart = dataStart
    const calibDataStart = calibStart + 16
    const calibDataEnd = calibDataStart + sizeF64
    if (calibDataEnd <= fileSize) {
      const startWn = view.getFloat64(calibStart, true)
      const stepWn = view.getFloat64(calibStart + 8, true)
      if (
        Number.isFinite(startWn) &&
        Number.isFinite(stepWn) &&
        Math.abs(stepWn) > 0 &&
        Math.abs(stepWn) < 100 &&
        Math.abs(startWn) > 0 &&
        Math.abs(startWn) < 10_000
      ) {
        const y = readFloat64Array(view, calibDataStart, nPoints)
        if (validateSpectralData(y)) {
          const x: number[] = new Array(nPoints)
          for (let i = 0; i < nPoints; i++) x[i] = startWn + i * stepWn
          return {
            x,
            y,
            xLabel: 'Raman Shift (cm\u207B\u00B9)',
            parseMethod: `structured_calib_offset_${headerOffset}`,
          }
        }
      }
    }
  }

  return null
}

// ── Strategy 2: fixed-size header + raw float data ──────────────

function tryChaFloatBlock(data: Uint8Array): ParseAttempt | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const fileSize = data.length

  for (const headerSize of FIXED_HEADER_SIZES) {
    if (fileSize <= headerSize) continue
    const remaining = fileSize - headerSize

    if (remaining % 8 === 0) {
      const nPts = remaining / 8
      if (nPts >= MIN_POINTS && nPts <= MAX_POINTS) {
        const y = readFloat64Array(view, headerSize, nPts)
        if (validateSpectralData(y)) {
          return {
            x: indexAxis(nPts),
            y,
            xLabel: 'Index',
            parseMethod: `float64_header_${headerSize}`,
          }
        }
      }
    }

    if (remaining % 4 === 0) {
      const nPts = remaining / 4
      if (nPts >= MIN_POINTS && nPts <= MAX_POINTS) {
        const y = readFloat32Array(view, headerSize, nPts)
        if (validateSpectralData(y)) {
          return {
            x: indexAxis(nPts),
            y,
            xLabel: 'Index',
            parseMethod: `float32_header_${headerSize}`,
          }
        }
      }
    }
  }

  return null
}

// ── helpers ─────────────────────────────────────────────────────

function readFloat64Array(view: DataView, off: number, count: number): number[] {
  const out: number[] = new Array(count)
  for (let i = 0; i < count; i++) out[i] = view.getFloat64(off + i * 8, true)
  return out
}

function readFloat32Array(view: DataView, off: number, count: number): number[] {
  const out: number[] = new Array(count)
  for (let i = 0; i < count; i++) out[i] = view.getFloat32(off + i * 4, true)
  return out
}

function indexAxis(n: number): number[] {
  const x: number[] = new Array(n)
  for (let i = 0; i < n; i++) x[i] = i
  return x
}

function validateSpectralData(y: number[]): boolean {
  if (y.length < 10) return false

  let finiteCount = 0
  let finiteMin = Number.POSITIVE_INFINITY
  let finiteMax = Number.NEGATIVE_INFINITY
  let finiteAbsMax = 0

  for (let i = 0; i < y.length; i++) {
    const v = y[i]
    if (!Number.isFinite(v)) continue
    finiteCount++
    if (v < finiteMin) finiteMin = v
    if (v > finiteMax) finiteMax = v
    const abs = Math.abs(v)
    if (abs > finiteAbsMax) finiteAbsMax = abs
  }

  if (finiteCount < y.length * 0.8) return false
  if (finiteCount === 0) return false
  if (finiteMax === finiteMin) return false
  if (finiteAbsMax > 1e15) return false
  return true
}

function toSpectrum(
  attempt: ParseAttempt,
  sourceFile: string,
): ParsedSpectrum | null {
  if (attempt.x.length < 2 || attempt.y.length < 2) return null
  if (attempt.x.length !== attempt.y.length) return null

  return {
    x: attempt.x,
    y: attempt.y,
    xLabel: attempt.xLabel,
    yLabel: 'Intensity',
    technique: 'Raman',
    metadata: {
      sourceFile,
      format: `Horiba LabSpec CHA (${attempt.parseMethod})`,
    },
  }
}
