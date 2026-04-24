// Philips PC-APD RD/SD XRD binary parser — ported from
// lattice-cli/src/lattice_cli/readers/native_readers.py::load_philips_rd
// Supports V3 ("V3RD") and V5 ("V5RD"). Little-endian throughout.
//
// Header layout (bytes):
//   0..4    magic "V3RD" or "V5RD"
//   84      uint8  diffractor type index
//   85      uint8  anode material index
//   86      uint8  focus type index
//   138..146  char[8]  file name
//   146..166  char[20] sample identification
//   214..222  float64 x_step
//   222..230  float64 x_start
//   230..238  float64 x_end
// Data starts at offset 250 (V3) or 810 (V5).
// Intensities are packed uint16; unpack as y = floor(0.01 * packed^2).

import type { ParsedSpectrum } from './types'

const DIFFRACTOR_TYPES = [
  'PW1800',
  'PW1710 based system',
  'PW1840',
  'PW3710 based system',
  'Undefined',
  "X'Pert MPD",
]
const ANODE_MATERIALS = ['Cu', 'Mo', 'Fe', 'Cr', 'Other']
const FOCUS_TYPES = ['BF', 'NF', 'FF', 'LFF']

const MIN_HEADER_BYTES = 240
const V3_DATA_OFFSET = 250
const V5_DATA_OFFSET = 810
const MAX_POINTS = 1_000_000

export function parsePhilipsRd(
  buffer: ArrayBuffer,
  sourceFile: string,
): ParsedSpectrum | null {
  const data = new Uint8Array(buffer)
  if (data.length < MIN_HEADER_BYTES) return null

  const magic = latin1(data, 0, 4)
  let version: 'V3' | 'V5'
  let dataOffset: number
  if (magic === 'V3RD') {
    version = 'V3'
    dataOffset = V3_DATA_OFFSET
  } else if (magic === 'V5RD') {
    version = 'V5'
    dataOffset = V5_DATA_OFFSET
  } else {
    return null
  }

  try {
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)

    const xStep = dv.getFloat64(214, true)
    const xStart = dv.getFloat64(222, true)
    const xEnd = dv.getFloat64(230, true)

    if (
      !Number.isFinite(xStep) ||
      !Number.isFinite(xStart) ||
      !Number.isFinite(xEnd) ||
      xStep <= 0 ||
      xEnd <= xStart
    ) {
      return null
    }

    // round((x_end - x_start) / x_step + 1)
    let nPoints = Math.floor((xEnd - xStart) / xStep + 1.5)
    if (!Number.isFinite(nPoints) || nPoints < 2 || nPoints > MAX_POINTS) {
      return null
    }

    // Clamp to available bytes (Python reader does the same).
    const available = data.length - dataOffset
    if (available < 4) return null
    const maxByBytes = Math.floor(available / 2)
    if (maxByBytes < nPoints) nPoints = maxByBytes
    if (nPoints < 2) return null

    const x = new Array<number>(nPoints)
    const y = new Array<number>(nPoints)
    for (let i = 0; i < nPoints; i++) {
      const packed = dv.getUint16(dataOffset + i * 2, true)
      // y = floor(0.01 * packed^2) — matches Python's np.floor cast.
      y[i] = Math.floor(0.01 * packed * packed)
      x[i] = xStart + i * xStep
    }

    const anode = readIndexed(data[85], ANODE_MATERIALS)
    const diffractor = readIndexed(data[84], DIFFRACTOR_TYPES)
    const focus = readIndexed(data[86], FOCUS_TYPES)
    const sampleName = cstr(data, 146, 20)

    const instrumentParts: string[] = []
    if (diffractor) instrumentParts.push(`Philips ${diffractor}`)
    else instrumentParts.push('Philips PC-APD')
    if (anode) instrumentParts.push(`${anode} anode`)
    if (focus) instrumentParts.push(`${focus} focus`)

    return {
      x,
      y,
      xLabel: '2\u03B8 (\u00B0)',
      yLabel: 'Intensity (counts)',
      technique: 'XRD',
      metadata: {
        instrument: instrumentParts.join(', '),
        sampleName: sampleName || undefined,
        sourceFile,
        format: `Philips PC-APD ${version}`,
      },
    }
  } catch {
    return null
  }
}

// ── helpers ─────────────────────────────────────────────────────

function latin1(data: Uint8Array, off: number, end: number): string {
  const chars: string[] = []
  for (let i = off; i < end && i < data.length; i++) {
    chars.push(String.fromCharCode(data[i]))
  }
  return chars.join('')
}

function cstr(data: Uint8Array, off: number, len: number): string {
  const chars: string[] = []
  for (let i = 0; i < len && off + i < data.length; i++) {
    const c = data[off + i]
    if (c === 0) break
    if (c >= 32 && c < 127) chars.push(String.fromCharCode(c))
  }
  return chars.join('').trim()
}

function readIndexed(idx: number | undefined, table: readonly string[]): string | undefined {
  if (idx === undefined) return undefined
  if (idx < 0 || idx >= table.length) return undefined
  return table[idx]
}
