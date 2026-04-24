// Bruker/Siemens RAW XRD binary parser — ported from
// lattice-cli/src/lattice_cli/readers/native_readers.py
// Supports v1 ("RAW "), v2 ("RAW2"), v3 ("RAW1.01"), v4 ("RAW4.00"),
// Rigaku SmartLab ("FI"), STOE WinXPow ("RAW_").

import type { ParsedSpectrum } from './types'

export function parseBrukerRaw(
  buffer: ArrayBuffer,
  sourceFile: string,
): ParsedSpectrum | null {
  const data = new Uint8Array(buffer)
  if (data.length < 10) return null

  const magic4 = latin1(data, 0, 4)
  const magic7 = data.length >= 7 ? latin1(data, 0, 7) : ''

  try {
    if (magic7 === 'RAW4.00') return brukerV4(data, sourceFile)
    if (magic7 === 'RAW1.01') return brukerV3(data, sourceFile)
    if (magic4 === 'RAW2') return brukerV2(data, sourceFile)
    if (magic4 === 'RAW ') return brukerV1(data, sourceFile)
    if (magic4.startsWith('FI')) return rigakuRaw(data, sourceFile)
    if (magic4 === 'RAW_') return stoeRaw(data, sourceFile)
  } catch {
    // fall through to text fallback
  }

  return textFallback(data, sourceFile)
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

function u16(data: Uint8Array, off: number): number {
  return data[off] | (data[off + 1] << 8)
}

function u32(data: Uint8Array, off: number): number {
  return (data[off] | (data[off + 1] << 8) | (data[off + 2] << 16) | (data[off + 3] << 24)) >>> 0
}

function f32(data: Uint8Array, off: number): number {
  return new DataView(data.buffer, data.byteOffset).getFloat32(off, true)
}

function f64(data: Uint8Array, off: number): number {
  return new DataView(data.buffer, data.byteOffset).getFloat64(off, true)
}

function f32Array(data: Uint8Array, off: number, count: number): number[] {
  const dv = new DataView(data.buffer, data.byteOffset)
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    out.push(dv.getFloat32(off + i * 4, true))
  }
  return out
}

function makeResult(
  x: number[],
  y: number[],
  sourceFile: string,
  format: string,
  meta?: Record<string, string | undefined>,
): ParsedSpectrum | null {
  if (x.length < 2) return null
  return {
    x,
    y,
    xLabel: '2\u03B8 (\u00B0)',
    yLabel: 'Intensity (counts)',
    technique: 'XRD',
    metadata: {
      sampleName: meta?.sampleName || undefined,
      date: meta?.date || undefined,
      instrument: meta?.instrument || undefined,
      sourceFile,
      format,
    },
  }
}

// ── v1: magic "RAW " ────────────────────────────────────────────

function brukerV1(data: Uint8Array, sourceFile: string): ParsedSpectrum | null {
  if (data.length < 160) return null
  const nPoints = u32(data, 4)
  const xStep = f32(data, 12)
  const xStart = f32(data, 24)
  const sampleName = cstr(data, 40, 32)

  if (nPoints < 2 || nPoints > 1_000_000) return null
  if (!Number.isFinite(xStep) || xStep <= 0) return null
  if (!Number.isFinite(xStart)) return null

  const dataOff = 156
  if (dataOff + nPoints * 4 > data.length) return null

  const y = f32Array(data, dataOff, nPoints)
  const x = Array.from({ length: nPoints }, (_, i) => xStart + i * xStep)

  return makeResult(x, y, sourceFile, 'Bruker RAW v1', { sampleName })
}

// ── v2: magic "RAW2" ────────────────────────────────────────────

function brukerV2(data: Uint8Array, sourceFile: string): ParsedSpectrum | null {
  if (data.length < 260) return null
  const rangeCnt = u16(data, 4)
  if (rangeCnt < 1 || rangeCnt > 256) return null

  const date = cstr(data, 168, 20)

  let pos = 256
  const allX: number[] = []
  const allY: number[] = []

  for (let r = 0; r < rangeCnt; r++) {
    if (pos + 20 > data.length) break
    const headerLen = u16(data, pos)
    const nSteps = u16(data, pos + 2)
    const xStep = f32(data, pos + 12)
    const xStart = f32(data, pos + 16)

    if (nSteps === 0 || !Number.isFinite(xStep) || xStep <= 0) {
      pos += headerLen + nSteps * 4
      continue
    }

    const dataStart = pos + headerLen
    const dataEnd = dataStart + nSteps * 4
    if (dataEnd > data.length) break

    for (let i = 0; i < nSteps; i++) {
      allX.push(xStart + i * xStep)
      allY.push(f32(data, dataStart + i * 4))
    }

    pos = dataEnd
    break // first range only
  }

  return makeResult(allX, allY, sourceFile, 'Bruker RAW v2', { date })
}

// ── v3: magic "RAW1.01" ─────────────────────────────────────────

function brukerV3(data: Uint8Array, sourceFile: string): ParsedSpectrum | null {
  if (data.length < 720) return null
  const rangeCnt = u32(data, 12)
  if (rangeCnt < 1 || rangeCnt > 256) return null

  const date = cstr(data, 16, 10) + ' ' + cstr(data, 26, 10)
  const sampleName = cstr(data, 326, 60)
  const instrument = cstr(data, 608, 4)

  let pos = 712
  const allX: number[] = []
  const allY: number[] = []

  for (let r = 0; r < rangeCnt; r++) {
    if (pos + 304 > data.length) break
    const headerLen = u32(data, pos)
    const steps = u32(data, pos + 4)
    const start2theta = f64(data, pos + 16)
    const stepSize = f64(data, pos + 176)

    let suppSize = 0
    if (pos + 260 <= data.length) {
      suppSize = u32(data, pos + 256)
    }

    if (steps === 0 || !Number.isFinite(stepSize) || stepSize <= 0) {
      pos += headerLen + suppSize + steps * 4
      continue
    }

    const dataStart = pos + headerLen + suppSize
    const dataEnd = dataStart + steps * 4
    if (dataEnd > data.length) break

    for (let i = 0; i < steps; i++) {
      allX.push(start2theta + i * stepSize)
      allY.push(f32(data, dataStart + i * 4))
    }

    pos = dataEnd
    break
  }

  return makeResult(allX, allY, sourceFile, 'Bruker RAW v3', {
    sampleName,
    date: date.trim(),
    instrument,
  })
}

// ── v4: magic "RAW4.00" ─────────────────────────────────────────

function brukerV4(data: Uint8Array, sourceFile: string): ParsedSpectrum | null {
  if (data.length < 70) return null

  const date = cstr(data, 12, 12) + ' ' + cstr(data, 24, 10)
  let instrument: string | undefined

  // skip 61-byte file header, then walk TLV metadata segments
  let pos = 61
  while (pos + 8 <= data.length) {
    const segType = u32(data, pos)
    if (segType === 0 || segType === 160) break
    const segLen = u32(data, pos + 4)
    if (segLen < 8) break

    if (segType === 30 && segLen >= 120 && pos + 120 <= data.length) {
      instrument = cstr(data, pos + 116, 4)
    }

    pos += segLen
  }

  // process range blocks
  const allX: number[] = []
  const allY: number[] = []

  while (pos + 160 <= data.length) {
    const segType = u32(data, pos)
    if (segType !== 0 && segType !== 160) break

    const startAngle = f64(data, pos + 72)
    const stepSize = f64(data, pos + 80)
    const steps = u32(data, pos + 88)
    const datumSize = u32(data, pos + 136) || 4
    const hdrSize = u32(data, pos + 140)

    if (steps === 0 || !Number.isFinite(stepSize) || stepSize <= 0) {
      pos += 160 + hdrSize
      continue
    }

    const dataStart = pos + 160 + hdrSize
    const dataEnd = dataStart + steps * datumSize
    if (dataEnd > data.length) break

    for (let i = 0; i < steps; i++) {
      allX.push(startAngle + i * stepSize)
      allY.push(f32(data, dataStart + i * datumSize))
    }

    pos = dataEnd
    break
  }

  return makeResult(allX, allY, sourceFile, 'Bruker RAW v4', {
    date: date.trim(),
    instrument,
  })
}

// ── Rigaku SmartLab ("FI") ──────────────────────────────────────

function rigakuRaw(data: Uint8Array, sourceFile: string): ParsedSpectrum | null {
  // Keep this aligned with lattice-cli's native Rigaku reader: SmartLab
  // headers contain many integer fields, and naively grabbing the first
  // larger value after `start_2theta` can stretch a 10–90° scan into a
  // bogus 10–260° axis. That is exactly what pushed quartz peaks out to
  // ~62° in the UI and broke downstream phase matching.
  const daOff = data.findIndex(
    (_byte, i) =>
      i <= data.length - 4 &&
      data[i] === 0x44 &&
      data[i + 1] === 0x41 &&
      data[i + 2] === 0 &&
      data[i + 3] === 0,
  )
  if (daOff < 0 || daOff + 24 > data.length) return null

  let nPoints = 0
  let dataStart = 0
  let useDaBlock = false

  const daPoints = u32(data, daOff + 16)
  const daDataStart = daOff + 20
  const daDataEnd = daDataStart + daPoints * 4
  if (daPoints >= 100 && daPoints <= 100_000 && daDataEnd <= data.length) {
    nPoints = daPoints
    dataStart = daDataStart
    useDaBlock = true
  }

  if (!useDaBlock) {
    if (data.length < 20) return null
    nPoints = u16(data, 12)
    if (nPoints < 2 || nPoints > 100_000) return null
    const dataSize = nPoints * 4
    if (dataSize > data.length) return null
    dataStart = data.length - dataSize
  }

  const y = f32Array(data, dataStart, nPoints)

  let xStep = useDaBlock ? 0.01 : 0.02
  let xStart = 5.0
  let foundParams = false

  const piOff = data.findIndex(
    (_byte, i) =>
      i <= data.length - 4 &&
      data[i] === 0x50 &&
      data[i + 1] === 0x49 &&
      data[i + 2] === 0 &&
      data[i + 3] === 0,
  )

  // Strategy A: PI block integer encoding in 1/100 degree units.
  if (piOff >= 0 && piOff + 12 <= dataStart && nPoints > 1) {
    const startInt = u32(data, piOff + 8)
    const start = startInt / 100
    if (start >= 3 && start <= 30) {
      for (let extra = 4; extra < 36; extra += 4) {
        const off = piOff + 8 + extra
        if (off + 4 > dataStart) break
        const end = u32(data, off) / 100
        const step = (end - start) / (nPoints - 1)
        if (start < end && end <= 160 && step >= 0.001 && step <= 0.1) {
          xStart = start
          xStep = step
          foundParams = true
          break
        }
      }
      if (!foundParams) {
        xStart = start
        foundParams = true
      }
    }
  }

  // Strategy B: consecutive float32 pair `(step, start)` somewhere in
  // the header. Used by some SmartLab exports when the PI integers are
  // sparse / padded.
  if (!foundParams) {
    const limit = Math.min(dataStart, data.length - 8)
    for (let off = 0; off <= limit; off += 4) {
      const step = f32(data, off)
      const start = f32(data, off + 4)
      if (
        Number.isFinite(step) &&
        Number.isFinite(start) &&
        step >= 0.005 &&
        step <= 0.1 &&
        start >= 3 &&
        start <= 30
      ) {
        xStep = step
        xStart = start
        foundParams = true
        break
      }
    }
  }

  const x = Array.from({ length: nPoints }, (_, i) => xStart + i * xStep)
  return makeResult(x, y, sourceFile, 'Rigaku SmartLab')
}

// ── STOE WinXPow ("RAW_") ──────────────────────────────────────

function stoeRaw(data: Uint8Array, sourceFile: string): ParsedSpectrum | null {
  if (data.length < 100) return null

  // STOE uses a simple header + float32 data; offsets vary
  for (const hdrSize of [64, 80, 128, 256]) {
    if (data.length < hdrSize + 12) continue
    const nPoints = u32(data, hdrSize - 4)
    if (nPoints < 10 || nPoints > 500_000) continue
    if (hdrSize + nPoints * 4 > data.length) continue

    const y = f32Array(data, hdrSize, nPoints)
    const allFinite = y.every((v) => Number.isFinite(v) && v >= 0)
    if (!allFinite) continue

    const x = Array.from({ length: nPoints }, (_, i) => i * 0.02)
    return makeResult(x, y, sourceFile, 'STOE WinXPow')
  }

  return null
}

// ── text fallback for .raw that are actually ASCII ──────────────

function textFallback(data: Uint8Array, sourceFile: string): ParsedSpectrum | null {
  // check if mostly ASCII
  let nulls = 0
  const sample = Math.min(4096, data.length)
  for (let i = 0; i < sample; i++) {
    if (data[i] === 0) nulls++
  }
  if (nulls > sample * 0.05) return null

  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: false }).decode(data)
  } catch {
    return null
  }

  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'))
  const x: number[] = []
  const y: number[] = []
  for (const line of lines) {
    const parts = line.trim().split(/[\s,;]+/)
    if (parts.length < 2) continue
    const a = Number(parts[0])
    const b = Number(parts[1])
    if (Number.isFinite(a) && Number.isFinite(b)) {
      x.push(a)
      y.push(b)
    }
  }

  return x.length >= 3
    ? makeResult(x, y, sourceFile, 'RAW (text)')
    : null
}
