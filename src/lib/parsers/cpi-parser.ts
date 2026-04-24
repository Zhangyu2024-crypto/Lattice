import type { ParsedSpectrum } from './types'

// Sietronics CPI (.cpi): XRD text format.
// Header encodes start/end/step either as `KEY=VALUE` lines or three sequential
// numeric lines (start, end, step). Data is a single intensity column.
export function parseCpi(text: string, sourceFile: string): ParsedSpectrum | null {
  const lines = text.split(/\r?\n/)

  let start: number | null = null
  let step: number | null = null
  let end: number | null = null
  let headerEnd = 0

  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim()
    if (!stripped) continue
    const lower = stripped.toLowerCase()

    if (lower.includes('=')) {
      const [key, value] = stripped.split('=', 2)
      const v = Number(value?.trim())
      if (Number.isFinite(v)) {
        const k = key.trim().toLowerCase()
        if (k.includes('start')) start = v
        else if (k.includes('end')) end = v
        else if (k.includes('step')) step = v
      }
      continue
    }

    if (Number.isFinite(Number(stripped))) {
      headerEnd = i
      break
    }
  }

  // Fallback: three consecutive numeric lines encoding start / end / step.
  if (start == null || step == null) {
    const numericHeader: Array<{ index: number; value: number }> = []
    for (let i = 0; i < lines.length; i++) {
      const stripped = lines[i].trim()
      if (!stripped) continue
      const n = Number(stripped)
      if (Number.isFinite(n)) {
        numericHeader.push({ index: i, value: n })
        if (numericHeader.length >= 3) break
      } else if (numericHeader.length > 0) {
        break
      }
    }
    if (numericHeader.length >= 3) {
      start = numericHeader[0].value
      end = numericHeader[1].value
      step = numericHeader[2].value
      headerEnd = numericHeader[2].index + 1
    }
  }

  const s = start ?? 0
  const d = step ?? 0.02

  const ys: number[] = []
  for (let i = headerEnd; i < lines.length; i++) {
    const stripped = lines[i].trim()
    if (!stripped) continue
    const n = Number(stripped)
    if (Number.isFinite(n)) ys.push(n)
  }

  if (ys.length < 2 || d <= 0) return null
  void end

  const xs = Array.from({ length: ys.length }, (_, i) => s + d * i)

  return {
    x: xs,
    y: ys,
    xLabel: '2\u03B8 (\u00B0)',
    yLabel: 'Intensity (counts)',
    technique: 'XRD',
    metadata: {
      sourceFile,
      format: 'Sietronics CPI',
    },
  }
}
