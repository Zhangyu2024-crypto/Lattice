// Thermo Scientific (.spa) / PerkinElmer (.sp) FTIR binary parser — ported
// from lattice-cli/src/lattice_cli/readers/native_readers.py::load_thermo_sp
// (plus its _fallback_thermo_parse helper).
//
// Strategy mirrors the Python reference:
//   1. Structured path: after a 4-byte signature and a 40-byte description,
//      walk (uint16 block_id, int32 block_size) TLV blocks at position 44+
//      and extract specific block IDs for wavelength range, point count,
//      and float64 spectral data.
//   2. Fallback: some .spa files are a fixed header (commonly 564 bytes)
//      followed by a raw float32 intensity array. Try a handful of plausible
//      header sizes and accept the first one that produces mostly-finite,
//      non-constant values. Attempt to recover a wavenumber range from a
//      pair of float64s near the start of the header.
//
// All reads are explicitly little-endian. The function never throws; any
// failure path returns null so the dispatcher can fall through to other
// parsers.
//
// Heuristic for Transmittance vs Absorbance: FTIR transmittance is typically
// reported in percent (0-100, occasionally slightly above/below), whereas
// absorbance is unitless and generally small (<~4). We inspect the recovered
// y-range to pick a reasonable label; when in doubt we default to
// Transmittance (%) to match the Thermo OMNIC default export.

import type { ParsedSpectrum } from './types'

// Block IDs from specio's reverse engineering of the Thermo SPA format.
const BLOCK_MIN_MAX_WL = 35698
const BLOCK_N_POINTS = 35701
const BLOCK_SPECTRUM = 35708

// Plausible fixed-header sizes for the fallback path (Python reference order).
const FALLBACK_HEADER_SIZES = [564, 512, 256, 128] as const

// Minimum file size the Python reference accepts.
const MIN_FILE_SIZE = 50

// Wavenumber sanity range used for both structured and fallback detection.
const WAVENUMBER_MIN = 100
const WAVENUMBER_MAX = 50000

// Offset inside the header where the fallback probes for a (min, max)
// wavenumber pair encoded as two little-endian float64s.
const FALLBACK_WL_PROBE_OFFSET = 8

export function parseThermoSp(
  buffer: ArrayBuffer,
  sourceFile: string,
): ParsedSpectrum | null {
  const data = new Uint8Array(buffer)
  if (data.length < MIN_FILE_SIZE) return null

  try {
    const structured = parseStructured(data)
    if (structured) return buildResult(structured, data, sourceFile, 'Thermo SPA')

    const fallback = parseFallback(data)
    if (fallback) return buildResult(fallback, data, sourceFile, 'Thermo SPA (fallback)')
  } catch {
    // Swallow any unexpected DataView errors and return null per contract.
  }
  return null
}

// ── structured block-based parser ───────────────────────────────

interface ParsedCore {
  y: number[]
  minWl: number | null
  maxWl: number | null
}

function parseStructured(data: Uint8Array): ParsedCore | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

  let minWl: number | null = null
  let maxWl: number | null = null
  let nPoints: number | null = null
  let y: number[] | null = null

  let pos = 44 // skip 4-byte signature + 40-byte description
  while (pos + 6 <= data.length) {
    const blockId = view.getUint16(pos, true)
    const blockSize = view.getInt32(pos + 2, true)
    pos += 6

    if (blockSize <= 0 || pos + blockSize > data.length) {
      // Invalid block — advance a single byte relative to the failed header
      // so we resync (mirrors Python's "pos -= 4 then continue").
      pos -= 4
      continue
    }

    if (blockId === BLOCK_MIN_MAX_WL && blockSize >= 18) {
      // 2-byte var_id, then two float64s (min, max).
      const a = view.getFloat64(pos + 2, true)
      const b = view.getFloat64(pos + 10, true)
      if (Number.isFinite(a) && Number.isFinite(b)) {
        minWl = a
        maxWl = b
      }
    } else if (blockId === BLOCK_N_POINTS && blockSize >= 6) {
      // 2-byte var_id, then uint32 point count.
      const n = view.getUint32(pos + 2, true)
      if (n > 0) nPoints = n
    } else if (blockId === BLOCK_SPECTRUM && blockSize >= 6) {
      // 2-byte var_id, 4-byte var_size, then float64 samples.
      const varSize = view.getUint32(pos + 2, true)
      const dataStart = pos + 6
      const dataEnd = dataStart + varSize
      if (varSize > 0 && varSize % 8 === 0 && dataEnd <= data.length) {
        const count = varSize / 8
        const samples: number[] = new Array(count)
        for (let i = 0; i < count; i++) {
          samples[i] = view.getFloat64(dataStart + i * 8, true)
        }
        y = samples
      }
    }

    pos += blockSize
  }

  if (!y || y.length === 0) return null

  // If the explicit point count disagrees with the sample count, prefer the
  // sample count (Python's linspace uses len(spectrum_data) regardless).
  if (nPoints !== null && nPoints !== y.length) {
    // Intentionally no-op: keep the directly-parsed array as the source of truth.
  }

  return { y, minWl, maxWl }
}

// ── fallback header + float32 parser ────────────────────────────

function parseFallback(data: Uint8Array): ParsedCore | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

  for (const headerSize of FALLBACK_HEADER_SIZES) {
    if (data.length <= headerSize) continue

    const rawBytes = data.length - headerSize
    const usableBytes = rawBytes - (rawBytes % 4)
    if (usableBytes < 40) continue // need at least 10 float32 samples

    const count = usableBytes / 4
    const samples: number[] = new Array(count)
    let finiteCount = 0
    let minVal = Number.POSITIVE_INFINITY
    let maxVal = Number.NEGATIVE_INFINITY

    for (let i = 0; i < count; i++) {
      const v = view.getFloat32(headerSize + i * 4, true)
      samples[i] = v
      if (Number.isFinite(v)) {
        finiteCount++
        if (v < minVal) minVal = v
        if (v > maxVal) maxVal = v
      }
    }

    if (finiteCount < count * 0.5) continue
    if (minVal === maxVal) continue

    let minWl: number | null = null
    let maxWl: number | null = null
    if (headerSize >= FALLBACK_WL_PROBE_OFFSET + 16) {
      const v1 = view.getFloat64(FALLBACK_WL_PROBE_OFFSET, true)
      const v2 = view.getFloat64(FALLBACK_WL_PROBE_OFFSET + 8, true)
      if (
        Number.isFinite(v1) &&
        Number.isFinite(v2) &&
        Math.abs(v1) > WAVENUMBER_MIN &&
        Math.abs(v1) < WAVENUMBER_MAX &&
        Math.abs(v2) > WAVENUMBER_MIN &&
        Math.abs(v2) < WAVENUMBER_MAX &&
        v1 !== v2
      ) {
        minWl = Math.min(v1, v2)
        maxWl = Math.max(v1, v2)
      }
    }

    return { y: samples, minWl, maxWl }
  }

  return null
}

// ── result assembly ─────────────────────────────────────────────

function buildResult(
  core: ParsedCore,
  data: Uint8Array,
  sourceFile: string,
  format: string,
): ParsedSpectrum | null {
  const { y, minWl, maxWl } = core
  if (y.length < 2) return null

  const x: number[] = new Array(y.length)
  if (minWl !== null && maxWl !== null && y.length > 1) {
    const step = (maxWl - minWl) / (y.length - 1)
    for (let i = 0; i < y.length; i++) x[i] = minWl + i * step
  } else {
    for (let i = 0; i < y.length; i++) x[i] = i
  }

  const xLabel = minWl !== null && maxWl !== null ? 'Wavenumber (cm\u207B\u00B9)' : 'Index'
  const yLabel = inferYLabel(y)
  const description = readDescription(data)

  return {
    x,
    y,
    xLabel,
    yLabel,
    technique: 'FTIR',
    metadata: {
      sampleName: description || undefined,
      sourceFile,
      format,
    },
  }
}

function readDescription(data: Uint8Array): string {
  // Bytes 4..44 hold a 40-byte ASCII description (null-padded).
  const end = Math.min(44, data.length)
  const chars: string[] = []
  for (let i = 4; i < end; i++) {
    const c = data[i]
    if (c === 0) break
    if (c >= 32 && c < 127) chars.push(String.fromCharCode(c))
  }
  return chars.join('').trim()
}

function inferYLabel(y: number[]): string {
  // Scan a bounded sample; FTIR files can be large and we only need a range
  // estimate to distinguish transmittance (~0-100) from absorbance (~0-4).
  const sampleSize = Math.min(y.length, 4096)
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let i = 0; i < sampleSize; i++) {
    const v = y[i]
    if (!Number.isFinite(v)) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return 'Transmittance (%)'
  // Absorbance is typically unitless and small; transmittance is 0..~100.
  if (max <= 6 && min >= -1) return 'Absorbance'
  return 'Transmittance (%)'
}
