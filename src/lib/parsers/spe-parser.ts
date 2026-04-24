// Princeton Instruments SPE binary parser — ported from
// lattice-cli/src/lattice_cli/readers/native_readers.py (load_spe, _load_spe_v2, _load_spe_v3).
//
// Layout (little-endian throughout):
//   v2: 4100-byte fixed header, then raw pixel data. x-axis comes from a
//       6-coefficient polynomial at offset 3263.
//   v3: same 4100-byte header and first-frame data, plus a UTF-8 XML footer.
//       The 64-bit offset at header byte 678 points at the footer; its
//       <Calibrations>/<Wavelength> node carries either a comma-separated
//       wavelength list or PolynomialCoefficients.
//
// Only the first frame / first row is emitted — multi-frame acquisitions are
// not exposed by ParsedSpectrum yet (see caveat in report).

import type { ParsedSpectrum, SpectroscopyTechnique } from './types'

const HEADER_SIZE = 4100
const XML_OFFSET_POS = 678

// datatype code → (bytes per sample, DataView reader)
type Reader = (dv: DataView, off: number) => number
interface DType {
  size: number
  read: Reader
}

const DTYPES: Record<number, DType> = {
  0: { size: 4, read: (dv, off) => dv.getFloat32(off, true) }, // f32
  1: { size: 4, read: (dv, off) => dv.getInt32(off, true) },   // i32
  2: { size: 2, read: (dv, off) => dv.getInt16(off, true) },   // i16
  3: { size: 2, read: (dv, off) => dv.getUint16(off, true) },  // u16
}

export function parseSpe(
  buffer: ArrayBuffer,
  sourceFile: string,
): ParsedSpectrum | null {
  try {
    if (buffer.byteLength < HEADER_SIZE + 4) return null

    const data = new Uint8Array(buffer)
    const dv = new DataView(buffer)

    // Decide v2 vs v3 from the 64-bit XML offset at byte 678.
    let xmlOffset = 0
    if (data.length >= XML_OFFSET_POS + 8) {
      // JS bigint → number is safe here because offsets are within file size.
      xmlOffset = Number(dv.getBigUint64(XML_OFFSET_POS, true))
    }

    const isV3 =
      xmlOffset > HEADER_SIZE &&
      xmlOffset < data.length &&
      Number.isFinite(xmlOffset)

    return isV3
      ? loadV3(data, dv, xmlOffset, sourceFile)
      : loadV2(data, dv, sourceFile)
  } catch {
    return null
  }
}

// ── v2: fixed struct header ────────────────────────────────────────────────

function loadV2(
  data: Uint8Array,
  dv: DataView,
  sourceFile: string,
): ParsedSpectrum | null {
  const header = readCommonHeader(dv)
  if (!header) return null

  const y = readFirstFrame(data, dv, header)
  if (!y) return null

  const x = polynomialAxis(dv, header.xdim) ?? pixelAxis(header.xdim)

  return buildResult(x, y, sourceFile, 'Princeton Instruments SPE v2', {
    version: header.ver,
    frames: header.nframes,
  })
}

// ── v3: same binary body, XML footer for calibration ──────────────────────

function loadV3(
  data: Uint8Array,
  dv: DataView,
  xmlOffset: number,
  sourceFile: string,
): ParsedSpectrum | null {
  const header = readCommonHeader(dv)
  if (!header) return null

  const y = readFirstFrame(data, dv, header)
  if (!y) return null

  const xmlBytes = data.subarray(xmlOffset)
  const xmlText = decodeXml(xmlBytes)

  let x: number[] | null = null
  if (xmlText) {
    x = wavelengthFromXml(xmlText, header.xdim)
  }
  if (!x) {
    x = polynomialAxis(dv, header.xdim) ?? pixelAxis(header.xdim)
  }

  return buildResult(x, y, sourceFile, 'Princeton Instruments SPE v3', {
    version: header.ver,
    frames: header.nframes,
    xmlBytes: xmlText ? String(xmlText.length) : undefined,
  })
}

// ── header / data helpers ──────────────────────────────────────────────────

interface CommonHeader {
  xdim: number
  ydim: number
  nframes: number
  datatype: number
  ver: number
}

function readCommonHeader(dv: DataView): CommonHeader | null {
  if (dv.byteLength < HEADER_SIZE) return null

  const xdim = dv.getUint16(42, true)
  const datatype = dv.getInt16(108, true)
  let ydim = dv.getUint16(656, true)
  let nframes = dv.getInt32(1446, true)
  const ver = dv.getFloat32(1992, true)

  if (xdim === 0) return null
  if (!(datatype in DTYPES)) return null
  if (ydim < 1) ydim = 1
  if (nframes < 1) nframes = 1

  return { xdim, ydim, nframes, datatype, ver }
}

function readFirstFrame(
  data: Uint8Array,
  dv: DataView,
  hdr: CommonHeader,
): number[] | null {
  const dtype = DTYPES[hdr.datatype]
  const expectedFirstRow = hdr.xdim * dtype.size
  if (HEADER_SIZE + expectedFirstRow > data.length) return null

  const out = new Array<number>(hdr.xdim)
  for (let i = 0; i < hdr.xdim; i++) {
    out[i] = dtype.read(dv, HEADER_SIZE + i * dtype.size)
  }
  return out
}

function polynomialAxis(dv: DataView, xdim: number): number[] | null {
  const coeffs: number[] = []
  for (let i = 0; i < 6; i++) {
    const off = 3263 + i * 8
    if (off + 8 > dv.byteLength) break
    coeffs.push(dv.getFloat64(off, true))
  }

  // Python check: any(c != 0 for c in coeffs[1:]) — need at least one
  // non-zero higher-order term; otherwise the polynomial is a constant and
  // carries no useful calibration.
  const hasHigherOrder = coeffs.slice(1).some((c) => c !== 0)
  if (!hasHigherOrder) return null

  const x = new Array<number>(xdim)
  for (let i = 0; i < xdim; i++) {
    let v = 0
    let pow = 1
    for (const c of coeffs) {
      v += c * pow
      pow *= i
    }
    x[i] = v
  }
  return x
}

function pixelAxis(xdim: number): number[] {
  const x = new Array<number>(xdim)
  for (let i = 0; i < xdim; i++) x[i] = i
  return x
}

// ── XML calibration extraction (isomorphic) ───────────────────────────────

function decodeXml(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  } catch {
    return null
  }
}

/**
 * Pull the wavelength axis out of the SPE v3 footer.
 *
 * Prefer DOMParser in the renderer for tag-aware navigation; fall back to
 * regex pulls on the two shapes we care about so the parser stays usable in
 * a Node / Electron main context.
 */
function wavelengthFromXml(xmlText: string, xdim: number): number[] | null {
  if (typeof DOMParser !== 'undefined') {
    const viaDom = wavelengthFromDom(xmlText, xdim)
    if (viaDom) return viaDom
  }
  return wavelengthFromRegex(xmlText, xdim)
}

function wavelengthFromDom(xmlText: string, xdim: number): number[] | null {
  try {
    const doc = new DOMParser().parseFromString(xmlText, 'text/xml')
    if (doc.getElementsByTagName('parsererror').length > 0) return null

    // getElementsByTagName('*') here is intentional — SPE footers may sit in
    // the Princeton Instruments namespace and localName lookups dodge that.
    const nodes = doc.getElementsByTagName('*')
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i]
      if (el.localName !== 'Wavelength') continue

      const text = el.textContent?.trim() ?? ''
      if (text.includes(',')) {
        const vals = parseFloatList(text)
        if (vals.length === xdim) return vals
      }

      const coeffStr = el.getAttribute('PolynomialCoefficients')
      if (coeffStr) {
        const coeffs = parseFloatList(coeffStr)
        if (coeffs.length > 0) return applyPolynomial(coeffs, xdim)
      }
    }
  } catch {
    return null
  }
  return null
}

function wavelengthFromRegex(xmlText: string, xdim: number): number[] | null {
  // 1) Comma-separated text content of any <Wavelength>…</Wavelength> block.
  const blockRe = /<(?:[\w-]+:)?Wavelength\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?Wavelength>/g
  let match: RegExpExecArray | null
  while ((match = blockRe.exec(xmlText)) !== null) {
    const attrs = match[1] ?? ''
    const body = (match[2] ?? '').trim()

    if (body && body.includes(',')) {
      const vals = parseFloatList(body)
      if (vals.length === xdim) return vals
    }

    const polyMatch = /PolynomialCoefficients\s*=\s*"([^"]+)"/i.exec(attrs)
    if (polyMatch) {
      const coeffs = parseFloatList(polyMatch[1])
      if (coeffs.length > 0) return applyPolynomial(coeffs, xdim)
    }
  }
  return null
}

function parseFloatList(text: string): number[] {
  const out: number[] = []
  for (const raw of text.split(',')) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    const v = Number(trimmed)
    if (Number.isFinite(v)) out.push(v)
  }
  return out
}

function applyPolynomial(coeffs: number[], xdim: number): number[] {
  const x = new Array<number>(xdim)
  for (let i = 0; i < xdim; i++) {
    let v = 0
    let pow = 1
    for (const c of coeffs) {
      v += c * pow
      pow *= i
    }
    x[i] = v
  }
  return x
}

// ── result assembly ───────────────────────────────────────────────────────

interface BuildMeta {
  version?: number
  frames?: number
  xmlBytes?: string
}

function buildResult(
  x: number[],
  y: number[],
  sourceFile: string,
  format: string,
  meta: BuildMeta,
): ParsedSpectrum | null {
  if (x.length < 2 || y.length < 2 || x.length !== y.length) return null

  // SPE overwhelmingly ships Raman / emission spectra. If the calibrated
  // x-axis falls in the visible-to-NIR wavelength range we label it as
  // wavelength; otherwise (polynomial disabled → raw pixel index) we still
  // call it Raman but label the axis as pixel index so it isn't misread.
  const looksLikeWavelength =
    x[0] > 100 && x[x.length - 1] < 5000 && x[x.length - 1] > x[0]
  const technique: SpectroscopyTechnique = 'Raman'
  const xLabel = looksLikeWavelength ? 'Wavelength (nm)' : 'Pixel'
  const yLabel = 'Intensity (counts)'

  const version = meta.version !== undefined && Number.isFinite(meta.version)
    ? `v${meta.version.toFixed(1)}`
    : undefined

  return {
    x,
    y,
    xLabel,
    yLabel,
    technique,
    metadata: {
      sourceFile,
      format: version ? `${format} (${version})` : format,
    },
  }
}
