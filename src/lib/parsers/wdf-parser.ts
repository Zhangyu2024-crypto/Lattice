// Renishaw WDF (.wdf) Raman binary parser — ported from
// lattice-cli/src/lattice_cli/readers/native_readers.py::load_wdf.
//
// WDF file layout:
//   - Root "WDF1" block (magic + UID + uint64 size) at offset 0, carries the
//     main header (npts at 0x3C, spectrum count at 0x48, laser wn at 0x34).
//   - Subsequent blocks share a 16-byte header: 4-byte tag + 4-byte UID +
//     uint64 block size (total, header inclusive). We walk them once and
//     pick DATA (intensities), XLST (x-axis), ORGN (per-spectrum metadata),
//     WMAP (mapping flags), TEXT (title).
//
// All integers / floats are little-endian. Returns spectrum 0 for multi-spectrum
// files. Returns null on any parse failure — never throws.
//
// Design note: Renishaw publishes an XLST-units enum where 1 = Raman Shift and
// 2 = Wavenumber; both are cm⁻¹. We use that to label the x axis, falling back
// to a generic label when the file reports something else (e.g. nanometre).

import type { ParsedSpectrum } from './types'

// WDF XLST data-type / units enums (subset — only what we label).
const WDF_UNITS_ARBITRARY = 0
const WDF_UNITS_RAMAN_SHIFT = 1
const WDF_UNITS_WAVENUMBER = 2
const WDF_UNITS_NANOMETRE = 3
const WDF_UNITS_ELECTRONVOLT = 4
const WDF_UNITS_MICRON = 5
const WDF_UNITS_PIXELS = 15

// Sanity caps to reject corrupt / hostile headers before any large allocation.
const MAX_POINTS = 1_000_000
const MAX_SPECTRA = 10_000_000

// ORGN entry → metadata key mapping (mirrors the Python reference).
const ORGN_TYPE_KEYS: Readonly<Record<number, string>> = {
  3: 'conditions.acquisition_time_s',
  8: 'source.laser_power_mw',
  13: 'conditions.exposure_time_s',
  14: 'conditions.temperature_k',
}

interface WdfMeta {
  sampleName?: string
  instrument?: string
  date?: string
  extra: Record<string, string>
}

export function parseWdf(
  buffer: ArrayBuffer,
  sourceFile: string,
): ParsedSpectrum | null {
  const data = new Uint8Array(buffer)
  if (data.length < 0x50) return null
  if (!matches(data, 0, 'WDF1')) return null

  try {
    return parseInner(data, sourceFile)
  } catch {
    return null
  }
}

function parseInner(
  data: Uint8Array,
  sourceFile: string,
): ParsedSpectrum | null {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)

  const nPoints = dv.getUint32(0x3c, true)
  const nSpectra = readU64Safe(dv, 0x48)
  if (nPoints < 2 || nPoints > MAX_POINTS) return null
  if (nSpectra < 1 || nSpectra > MAX_SPECTRA) return null

  const meta: WdfMeta = { extra: {} }

  // Laser excitation wavenumber (optional, useful provenance).
  const laserWn = dv.getFloat32(0x34, true)
  if (Number.isFinite(laserWn) && laserWn > 100 && laserWn < 50000) {
    meta.extra['source.laser_wavenumber_cm-1'] = laserWn.toFixed(2)
    meta.extra['source.laser_wavelength_nm'] = (1e7 / laserWn).toFixed(1)
  }

  // Root block size — skip past it to reach the block tree.
  const rootSize = readU64Safe(dv, 8)
  if (rootSize < 16 || rootSize > data.length) return null

  let xUnits = WDF_UNITS_ARBITRARY
  let xData: number[] | null = null
  let yData: number[] | null = null

  let pos = rootSize
  while (pos + 16 <= data.length) {
    const blockSize = readU64Safe(dv, pos + 8)
    if (blockSize < 16 || pos + blockSize > data.length) break
    const tag = latin1(data, pos, 4)
    const payloadStart = pos + 16
    const payloadSize = blockSize - 16

    if (tag === 'XLST' && xData === null) {
      const parsed = readXlst(dv, data, payloadStart, payloadSize, nPoints)
      if (parsed) {
        xData = parsed.values
        xUnits = parsed.units
      }
    } else if (tag === 'DATA' && yData === null) {
      yData = readData(dv, payloadStart, payloadSize, nPoints)
    } else if (tag === 'TEXT' && meta.extra['title'] === undefined) {
      const title = readText(data, payloadStart, payloadSize)
      if (title) {
        meta.extra['title'] = title
        if (!meta.sampleName) meta.sampleName = title
      }
    } else if (tag === 'ORGN' && payloadSize >= 24) {
      parseOrgn(dv, data, payloadStart, payloadSize, nSpectra, meta)
    } else if (tag === 'WMAP' && payloadSize >= 4) {
      const mapFlags = dv.getUint32(payloadStart, true)
      if (mapFlags !== 0) meta.extra['map.flags'] = String(mapFlags)
    } else if (tag === 'WXDA' && meta.instrument === undefined) {
      // WXDA (data collection origin) — mine printable strings for an instrument tag.
      const inst = scanPrintable(data, payloadStart, payloadSize, 200)
      if (inst) meta.instrument = inst
    }

    pos += blockSize
  }

  if (yData === null) return null
  if (xData === null || xData.length !== nPoints) {
    xData = Array.from({ length: nPoints }, (_, i) => i)
    xUnits = WDF_UNITS_PIXELS
  }

  meta.extra['n_points'] = String(nPoints)
  meta.extra['n_spectra'] = String(nSpectra)

  return {
    x: xData,
    y: yData,
    xLabel: xLabelFor(xUnits),
    yLabel: 'Intensity',
    technique: 'Raman',
    metadata: {
      instrument: meta.instrument,
      date: meta.date,
      sampleName: meta.sampleName,
      sourceFile,
      format: 'Renishaw WDF',
    },
  }
}

// ── block readers ───────────────────────────────────────────────

function readXlst(
  dv: DataView,
  data: Uint8Array,
  payloadStart: number,
  payloadSize: number,
  nPoints: number,
): { values: number[]; units: number } | null {
  // Canonical layout: uint32 type + uint32 units + npts × float32.
  // Fallback: raw float32 array (seen in older writers).
  const bytesNeeded = nPoints * 4
  if (payloadStart + 8 + bytesNeeded <= payloadStart + payloadSize) {
    const units = dv.getUint32(payloadStart + 4, true)
    const values = readFloat32Array(dv, payloadStart + 8, nPoints)
    return { values, units }
  }
  if (payloadSize >= bytesNeeded) {
    const values = readFloat32Array(dv, payloadStart, nPoints)
    return { values, units: WDF_UNITS_ARBITRARY }
  }
  return null
}

function readData(
  dv: DataView,
  payloadStart: number,
  payloadSize: number,
  nPoints: number,
): number[] | null {
  const totalFloats = Math.floor(payloadSize / 4)
  if (totalFloats < nPoints) return null
  return readFloat32Array(dv, payloadStart, nPoints)
}

function readText(
  data: Uint8Array,
  payloadStart: number,
  payloadSize: number,
): string | undefined {
  if (payloadSize <= 0) return undefined
  const slice = data.subarray(payloadStart, payloadStart + payloadSize)
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: false }).decode(slice)
  } catch {
    text = latin1(slice, 0, slice.length)
  }
  const trimmed = text.replace(/\u0000+$/g, '').trim()
  if (!trimmed || trimmed.length >= 500) return undefined
  return trimmed
}

function parseOrgn(
  dv: DataView,
  data: Uint8Array,
  start: number,
  size: number,
  nSpectra: number,
  meta: WdfMeta,
): void {
  const end = start + size
  const stride = nSpectra * 8
  if (stride <= 0) return
  let pos = start
  while (pos + 24 <= end) {
    const otype = dv.getUint32(pos, true)
    // +4: units (unused here)
    const label = cString(data, pos + 8, 16)
    pos += 24

    if (pos + stride > end) break
    const value = dv.getFloat64(pos, true)
    pos += stride

    if (!Number.isFinite(value)) continue
    const mag = Math.abs(value)
    if (mag <= 0 || mag >= 1e10) continue

    const formatted = formatSig4(value)
    const typedKey = ORGN_TYPE_KEYS[otype]
    if (typedKey) {
      meta.extra[typedKey] = formatted
    } else if (label && label !== 'Unknown') {
      meta.extra[`orgn.${label}`] = formatted
    }
  }
}

// ── byte / string helpers ────────────────────────────────────────

function readU64Safe(dv: DataView, off: number): number {
  // WDF sizes are expressed as uint64 but always fit in Number.MAX_SAFE_INTEGER
  // for any real-world file; clamp at that to avoid silent truncation surprises.
  const big = dv.getBigUint64(off, true)
  if (big > BigInt(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER
  return Number(big)
}

function readFloat32Array(dv: DataView, off: number, count: number): number[] {
  const out = new Array<number>(count)
  for (let i = 0; i < count; i++) {
    out[i] = dv.getFloat32(off + i * 4, true)
  }
  return out
}

function matches(data: Uint8Array, off: number, tag: string): boolean {
  if (off + tag.length > data.length) return false
  for (let i = 0; i < tag.length; i++) {
    if (data[off + i] !== tag.charCodeAt(i)) return false
  }
  return true
}

function latin1(data: Uint8Array, off: number, len: number): string {
  const chars: string[] = []
  const end = Math.min(off + len, data.length)
  for (let i = off; i < end; i++) chars.push(String.fromCharCode(data[i]))
  return chars.join('')
}

function cString(data: Uint8Array, off: number, len: number): string {
  const end = Math.min(off + len, data.length)
  const chars: string[] = []
  for (let i = off; i < end; i++) {
    const c = data[i]
    if (c === 0) break
    if (c >= 32 && c < 127) chars.push(String.fromCharCode(c))
  }
  return chars.join('').trim()
}

function scanPrintable(
  data: Uint8Array,
  off: number,
  len: number,
  maxLen: number,
): string | undefined {
  const end = Math.min(off + len, data.length)
  const runs: string[] = []
  let current: string[] = []
  for (let i = off; i < end; i++) {
    const c = data[i]
    if (c >= 32 && c < 127) {
      current.push(String.fromCharCode(c))
    } else if (current.length >= 4) {
      runs.push(current.join(''))
      current = []
    } else {
      current = []
    }
  }
  if (current.length >= 4) runs.push(current.join(''))
  const best = runs.find((s) => s.length >= 4 && s.length <= maxLen)
  return best?.trim() || undefined
}

function formatSig4(v: number): string {
  // Match Python's %.4g formatting closely enough for metadata display.
  const fixed = v.toPrecision(4)
  const n = Number(fixed)
  return Number.isFinite(n) ? String(n) : fixed
}

function xLabelFor(units: number): string {
  switch (units) {
    case WDF_UNITS_RAMAN_SHIFT:
    case WDF_UNITS_WAVENUMBER:
      return 'Raman Shift (cm\u207B\u00B9)'
    case WDF_UNITS_NANOMETRE:
      return 'Wavelength (nm)'
    case WDF_UNITS_ELECTRONVOLT:
      return 'Energy (eV)'
    case WDF_UNITS_MICRON:
      return 'Wavelength (\u00B5m)'
    case WDF_UNITS_PIXELS:
      return 'Pixel'
    case WDF_UNITS_ARBITRARY:
    default:
      return 'Raman Shift (cm\u207B\u00B9)'
  }
}
