import type { ParsedSpectrum } from './types'

const XRD_LABELS = { xLabel: '2\u03B8 (\u00B0)', yLabel: 'Intensity (counts)' } as const

// GSAS (.gsa): BANK header line encodes start/step (usually centidegrees),
// following lines are whitespace-separated intensity values (fixed step).
export function parseGsas(text: string, sourceFile: string): ParsedSpectrum | null {
  let start = 0
  let step = 0
  let bank = ''
  const ys: number[] = []
  let inData = false

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue

    if (line.startsWith('BANK')) {
      const parts = line.split(/\s+/)
      bank = parts[1] ?? '1'
      const upper = parts.map((p) => p.toUpperCase())
      const idx = upper.indexOf('CONST') !== -1 ? upper.indexOf('CONST') : upper.indexOf('CONS')
      if (idx !== -1 && parts.length > idx + 2) {
        const s = Number(parts[idx + 1])
        const d = Number(parts[idx + 2])
        if (Number.isFinite(s)) start = s
        if (Number.isFinite(d)) step = d
      }
      inData = true
      continue
    }

    if (!inData) continue
    for (const token of line.split(/\s+/)) {
      const n = Number(token)
      if (Number.isFinite(n)) ys.push(n)
    }
  }

  if (ys.length < 2 || step <= 0) return null

  // Centidegrees → degrees heuristic (start/step typically ≥100 when centidegrees).
  let s = start
  let d = step
  if (s >= 100) {
    s /= 100
    d /= 100
  }
  const xs = Array.from({ length: ys.length }, (_, i) => s + d * i)

  return {
    x: xs,
    y: ys,
    xLabel: XRD_LABELS.xLabel,
    yLabel: XRD_LABELS.yLabel,
    technique: 'XRD',
    metadata: {
      sourceFile,
      format: 'GSAS',
      ...(bank ? { instrument: `BANK ${bank}` } : {}),
    },
  }
}

// GSAS FXYE (.fxye): BANK header then 3-column data (2θ, intensity, error).
// x column is often stored in centidegrees (values > 1000).
export function parseFxye(text: string, sourceFile: string): ParsedSpectrum | null {
  const xs: number[] = []
  const ys: number[] = []
  let bank = ''

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('BANK')) {
      bank = line.split(/\s+/)[1] ?? '1'
      continue
    }
    if (line.startsWith('#') || line.startsWith('!')) continue

    const parts = line.split(/\s+/)
    if (parts.length < 2) continue
    let x = Number(parts[0])
    const y = Number(parts[1])
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    if (x > 1000) x /= 100
    xs.push(x)
    ys.push(y)
  }

  if (xs.length < 2) return null

  return {
    x: xs,
    y: ys,
    xLabel: XRD_LABELS.xLabel,
    yLabel: XRD_LABELS.yLabel,
    technique: 'XRD',
    metadata: {
      sourceFile,
      format: 'GSAS-FXYE',
      ...(bank ? { instrument: `BANK ${bank}` } : {}),
    },
  }
}
