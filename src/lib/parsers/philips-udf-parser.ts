import type { ParsedSpectrum } from './types'

// Philips UDF (.udf) XRD text format (xylib-derived layout).
// Header: `Key, Value1, Value2, ..., /` lines. `RawScan` marks data start;
// data lines are comma- (or whitespace-) separated integers, terminated by `/`.
export function parsePhilipsUdf(text: string, sourceFile: string): ParsedSpectrum | null {
  let xStart: number | null = null
  let xEnd: number | null = null
  let xStep: number | null = null
  let sample = ''
  let title = ''
  let anode = ''
  const intensities: number[] = []
  let inData = false

  const lines = text.split(/\r?\n/)
  for (const raw of lines) {
    const stripped = raw.trim()
    if (!stripped) continue

    if (stripped === 'RawScan') {
      inData = true
      continue
    }

    if (inData) {
      const hasSlash = stripped.includes('/')
      const cleaned = stripped.replace(/\//g, '').replace(/,/g, ' ')
      for (const token of cleaned.split(/\s+/)) {
        if (!token) continue
        const n = Number(token)
        if (Number.isFinite(n)) intensities.push(n)
      }
      if (hasSlash) break
      continue
    }

    // Header line: trim trailing ",/" or "/".
    let head = stripped
    if (head.endsWith(',/')) head = head.slice(0, -2)
    else if (head.endsWith('/')) head = head.slice(0, -1).replace(/,$/, '')

    const parts = head.split(',').map((p) => p.trim())
    if (parts.length < 2) continue

    const [key, ...rest] = parts
    switch (key) {
      case 'DataAngleRange':
        if (rest.length >= 2) {
          const a = Number(rest[0])
          const b = Number(rest[1])
          if (Number.isFinite(a)) xStart = a
          if (Number.isFinite(b)) xEnd = b
        }
        break
      case 'ScanStepSize': {
        const v = Number(rest[0])
        if (Number.isFinite(v)) xStep = v
        break
      }
      case 'SampleIdent':
        sample = rest[0] ?? ''
        break
      case 'Title1':
        title = rest[0] ?? ''
        break
      case 'Anode':
        anode = rest[0] ?? ''
        break
    }
  }

  if (intensities.length < 2) return null

  let xs: number[]
  if (xStart != null && xStep != null && xStep > 0) {
    const s = xStart
    const d = xStep
    xs = Array.from({ length: intensities.length }, (_, i) => s + d * i)
  } else if (xStart != null && xEnd != null && intensities.length > 1) {
    const s = xStart
    const e = xEnd
    const n = intensities.length
    xs = Array.from({ length: n }, (_, i) => s + (e - s) * (i / (n - 1)))
  } else {
    xs = Array.from({ length: intensities.length }, (_, i) => i)
  }

  return {
    x: xs,
    y: intensities,
    xLabel: '2\u03B8 (\u00B0)',
    yLabel: 'Intensity (counts)',
    technique: 'XRD',
    metadata: {
      instrument: anode ? `Philips (${anode} anode)` : 'Philips',
      sampleName: sample || title || undefined,
      sourceFile,
      format: 'Philips UDF',
    },
  }
}
