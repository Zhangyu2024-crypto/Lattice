// Galactic SPC (.spc) binary parser — ported from
// lattice-cli/src/lattice_cli/readers/native_readers.py (_spc_* functions).
// Supports:
//   - New format (version byte 0x4B / 0x4C, 512-byte main header)
//   - Old format (version byte 0x4D, 256-byte main header)
//   - y-only (evenly spaced x from ffirst/flast)
//   - TXVALS mode (shared float32 x array preceding y)
//   - TXYXYS mode (per-subfile independent x/y pairs; returns subfile 0)
// All integer and floating-point fields are little-endian.

import type { ParsedSpectrum, SpectroscopyTechnique } from './types'

// ftflgs bits (see SPC SDK)
const SPC_TSPREC = 0x01 // y stored as int16 (vs default int32)
const SPC_TXYXYS = 0x40 // multi-subfile, each with its own x/y
const SPC_TXVALS = 0x80 // single explicit x array precedes y blocks

// Size of each subfile sub-header (skipped; the only field we need — subnpts —
// is extracted at a known offset inside it for TXYXYS mode).
const SUBHEADER_SIZE = 32

interface NewHeader {
  ftflgs: number
  fexp: number
  fnpts: number
  ffirst: number
  flast: number
  fnsub: number
  fxtype: number
  fytype: number
  fexper: number
}

export function parseSpc(
  buffer: ArrayBuffer,
  sourceFile: string,
): ParsedSpectrum | null {
  try {
    if (buffer.byteLength < 256) return null
    const data = new Uint8Array(buffer)
    const dv = new DataView(buffer)

    const fversn = data[1]
    if (fversn === 0x4d) return parseOldFormat(data, dv, sourceFile)
    if (fversn === 0x4b || fversn === 0x4c) {
      return parseNewFormat(data, dv, sourceFile)
    }
    return null
  } catch {
    return null
  }
}

// ── New format (0x4B / 0x4C) ─────────────────────────────────────

function parseNewFormat(
  data: Uint8Array,
  dv: DataView,
  sourceFile: string,
): ParsedSpectrum | null {
  if (data.length < 512) return null

  const hdr: NewHeader = {
    ftflgs: data[0],
    fexp: readI8(dv, 3),
    fnpts: dv.getUint32(4, true),
    ffirst: dv.getFloat64(8, true),
    flast: dv.getFloat64(16, true),
    fnsub: dv.getUint32(24, true),
    fxtype: data[28],
    fytype: data[29],
    fexper: data[2],
  }

  if (hdr.fnpts === 0) return null
  if (hdr.fnpts > 100_000_000) return null // sanity cap

  let pos = 512
  const hasTxvals = (hdr.ftflgs & SPC_TXVALS) !== 0
  const hasTxyxys = (hdr.ftflgs & SPC_TXYXYS) !== 0

  let x: number[]
  let y: number[]

  if (hasTxyxys) {
    const result = readSubfileXy(data, dv, pos, hdr.fexp, hdr.ftflgs, hdr.fnpts)
    if (!result) return null
    x = result.x
    y = result.y
  } else if (hasTxvals) {
    const xBytes = hdr.fnpts * 4
    if (pos + xBytes > data.length) return null
    x = readF32Array(dv, pos, hdr.fnpts)
    pos += xBytes
    const yRes = readSubfileY(data, dv, pos, hdr.fnpts, hdr.fexp, hdr.ftflgs)
    if (!yRes) return null
    y = yRes.y
  } else {
    x = linspace(hdr.ffirst, hdr.flast, hdr.fnpts)
    const yRes = readSubfileY(data, dv, pos, hdr.fnpts, hdr.fexp, hdr.ftflgs)
    if (!yRes) return null
    y = yRes.y
  }

  if (x.length < 2 || x.length !== y.length) return null
  if (!allFinite(x) || !allFinite(y)) return null

  const technique = pickTechnique(hdr.fxtype, hdr.fexper)
  const { xLabel, yLabel } = pickLabels(hdr.fxtype, hdr.fytype, technique)

  return {
    x,
    y,
    xLabel,
    yLabel,
    technique,
    metadata: {
      sampleName: extractMemo(data) || undefined,
      date: extractDate(dv) || undefined,
      instrument: extractInstrument(data) || undefined,
      sourceFile,
      format: `SPC new (0x${data[1].toString(16).toUpperCase().padStart(2, '0')})`,
    },
  }
}

// ── Old format (0x4D) ────────────────────────────────────────────

function parseOldFormat(
  data: Uint8Array,
  dv: DataView,
  sourceFile: string,
): ParsedSpectrum | null {
  if (data.length < 256) return null

  const ftflgs = data[0]
  const oexp = readI8(dv, 3)
  const onpts = dv.getUint16(4, true)
  const ofirst = dv.getFloat32(8, true)
  const olast = dv.getFloat32(12, true)

  if (onpts === 0) return null

  const x = linspace(ofirst, olast, onpts)
  const yRes = readSubfileY(data, dv, 256, onpts, oexp, ftflgs)
  if (!yRes) return null
  const y = yRes.y

  if (x.length < 2 || x.length !== y.length) return null
  if (!allFinite(x) || !allFinite(y)) return null

  // Old format does not carry detailed axis-type codes; default to Raman.
  return {
    x,
    y,
    xLabel: 'Raman Shift (cm\u207B\u00B9)',
    yLabel: 'Intensity',
    technique: 'Raman',
    metadata: {
      sourceFile,
      format: 'SPC old (0x4D)',
    },
  }
}

// ── subfile readers ──────────────────────────────────────────────

interface YResult {
  y: number[]
  pos: number
}

function readSubfileY(
  data: Uint8Array,
  dv: DataView,
  pos: number,
  npts: number,
  fexp: number,
  ftflgs: number,
): YResult | null {
  const start = pos + SUBHEADER_SIZE
  const is16bit = (ftflgs & SPC_TSPREC) !== 0

  if (fexp === -128) {
    // IEEE float32 y values — exponent flag sentinel
    const nbytes = npts * 4
    if (start + nbytes > data.length) return null
    return { y: readF32Array(dv, start, npts), pos: start + nbytes }
  }
  if (is16bit) {
    const nbytes = npts * 2
    if (start + nbytes > data.length) return null
    const scale = Math.pow(2, fexp - 16)
    const y = new Array<number>(npts)
    for (let i = 0; i < npts; i++) {
      y[i] = dv.getInt16(start + i * 2, true) * scale
    }
    return { y, pos: start + nbytes }
  }
  const nbytes = npts * 4
  if (start + nbytes > data.length) return null
  const scale = Math.pow(2, fexp - 32)
  const y = new Array<number>(npts)
  for (let i = 0; i < npts; i++) {
    y[i] = dv.getInt32(start + i * 4, true) * scale
  }
  return { y, pos: start + nbytes }
}

interface XyResult {
  x: number[]
  y: number[]
  pos: number
}

function readSubfileXy(
  data: Uint8Array,
  dv: DataView,
  pos: number,
  fexp: number,
  ftflgs: number,
  fnpts: number,
): XyResult | null {
  // Per-subfile point count lives at offset +16 inside the 32-byte subheader.
  let subnpts = 0
  if (pos + 20 <= data.length) {
    subnpts = dv.getUint32(pos + 16, true)
  }
  if (subnpts === 0) subnpts = fnpts
  if (subnpts === 0 || subnpts > 100_000_000) return null

  const xStart = pos + SUBHEADER_SIZE
  const xBytes = subnpts * 4
  if (xStart + xBytes > data.length) return null
  const x = readF32Array(dv, xStart, subnpts)

  const yPos = xStart + xBytes
  const is16bit = (ftflgs & SPC_TSPREC) !== 0

  let y: number[]
  let end: number
  if (fexp === -128) {
    const nbytes = subnpts * 4
    if (yPos + nbytes > data.length) return null
    y = readF32Array(dv, yPos, subnpts)
    end = yPos + nbytes
  } else if (is16bit) {
    const nbytes = subnpts * 2
    if (yPos + nbytes > data.length) return null
    const scale = Math.pow(2, fexp - 16)
    y = new Array<number>(subnpts)
    for (let i = 0; i < subnpts; i++) {
      y[i] = dv.getInt16(yPos + i * 2, true) * scale
    }
    end = yPos + nbytes
  } else {
    const nbytes = subnpts * 4
    if (yPos + nbytes > data.length) return null
    const scale = Math.pow(2, fexp - 32)
    y = new Array<number>(subnpts)
    for (let i = 0; i < subnpts; i++) {
      y[i] = dv.getInt32(yPos + i * 4, true) * scale
    }
    end = yPos + nbytes
  }
  return { x, y, pos: end }
}

// ── metadata helpers (new format only) ───────────────────────────

function extractMemo(data: Uint8Array): string {
  // 130-byte memo at offset 130
  if (data.length < 260) return ''
  return latin1Clean(data, 130, 130)
}

function extractInstrument(data: Uint8Array): string {
  // 8-byte instrument/source description at offset 42
  if (data.length < 50) return ''
  return latin1Clean(data, 42, 8)
}

function extractDate(dv: DataView): string {
  if (dv.byteLength < 34) return ''
  const fdate = dv.getUint32(30, true)
  if (fdate === 0) return ''
  const year = (fdate >>> 20) & 0xfff
  const month = (fdate >>> 16) & 0xf
  const day = (fdate >>> 11) & 0x1f
  const hour = (fdate >>> 6) & 0x1f
  const minute = fdate & 0x3f
  if (year < 1900 || year > 2100) return ''
  if (month < 1 || month > 12) return ''
  if (day < 1 || day > 31) return ''
  const pad = (n: number, w = 2): string => n.toString().padStart(w, '0')
  return `${pad(year, 4)}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}`
}

// ── technique + label mapping ────────────────────────────────────

function pickTechnique(
  fxtype: number,
  fexper: number,
): SpectroscopyTechnique {
  // Experiment type is the strongest signal when present.
  switch (fexper) {
    case 4: // FT-IR / FT-NIR / FT-Raman
      // cm^-1 axis is shared with Raman; fall through to x-type heuristic
      break
    case 8:
      return 'XRD'
    case 11:
      return 'Raman'
    case 5: // NIR
    case 7: // UV-VIS
    case 12: // Fluorescence
      return 'Curve'
  }

  // fxtype: 1 = Wavenumber (cm^-1), 13 = Raman Shift (cm^-1),
  // 2 = micrometers, 3 = nanometers, 14 = eV
  if (fxtype === 13) return 'Raman'
  if (fxtype === 1) {
    // Wavenumber is ambiguous between FTIR and Raman. Prefer the
    // experiment-type hint; otherwise default to Raman per contract.
    if (fexper === 4) return 'FTIR'
    return 'Raman'
  }
  if (fxtype === 14) return 'XPS' // eV
  if (fxtype === 2 || fxtype === 3) return 'Curve' // wavelength
  return 'Raman'
}

function pickLabels(
  fxtype: number,
  fytype: number,
  technique: SpectroscopyTechnique,
): { xLabel: string; yLabel: string } {
  const xLabel = xAxisLabel(fxtype, technique)
  const yLabel = yAxisLabel(fytype)
  return { xLabel, yLabel }
}

function xAxisLabel(fxtype: number, technique: SpectroscopyTechnique): string {
  switch (fxtype) {
    case 1:
      return technique === 'FTIR'
        ? 'Wavenumber (cm\u207B\u00B9)'
        : 'Raman Shift (cm\u207B\u00B9)'
    case 2:
      return 'Wavelength (\u03BCm)'
    case 3:
      return 'Wavelength (nm)'
    case 13:
      return 'Raman Shift (cm\u207B\u00B9)'
    case 14:
      return 'Binding Energy (eV)'
    default:
      if (technique === 'XRD') return '2\u03B8 (\u00B0)'
      if (technique === 'XPS') return 'Binding Energy (eV)'
      if (technique === 'FTIR') return 'Wavenumber (cm\u207B\u00B9)'
      if (technique === 'Raman') return 'Raman Shift (cm\u207B\u00B9)'
      return 'X'
  }
}

function yAxisLabel(fytype: number): string {
  switch (fytype) {
    case 2:
      return 'Absorbance'
    case 4:
      return 'Intensity (counts)'
    case 5:
      return 'Volts'
    case 11:
      return 'Percent'
    case 12:
    case 13:
      return 'Intensity'
    case 14:
      return 'Energy'
    case 128:
      return 'Transmittance'
    case 129:
      return 'Reflectance'
    default:
      return 'Intensity'
  }
}

// ── low-level helpers ────────────────────────────────────────────

function readI8(dv: DataView, off: number): number {
  return dv.getInt8(off)
}

function readF32Array(dv: DataView, off: number, count: number): number[] {
  const out = new Array<number>(count)
  for (let i = 0; i < count; i++) {
    out[i] = dv.getFloat32(off + i * 4, true)
  }
  return out
}

function linspace(start: number, stop: number, n: number): number[] {
  if (n <= 0) return []
  if (n === 1) return [start]
  const out = new Array<number>(n)
  const step = (stop - start) / (n - 1)
  for (let i = 0; i < n; i++) out[i] = start + i * step
  return out
}

function latin1Clean(data: Uint8Array, off: number, len: number): string {
  const end = Math.min(off + len, data.length)
  const chars: string[] = []
  for (let i = off; i < end; i++) {
    const c = data[i]
    if (c === 0) break
    chars.push(String.fromCharCode(c))
  }
  return chars.join('').trim()
}

function allFinite(arr: number[]): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) return false
  }
  return true
}
