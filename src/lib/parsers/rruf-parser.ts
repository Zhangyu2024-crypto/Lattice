import type { ParsedSpectrum } from './types'

// RRUFF Raman (.rruf): `##KEY=VALUE` metadata lines, `#` comments,
// then 2-column data (comma- or whitespace-separated).
export function parseRruf(text: string, sourceFile: string): ParsedSpectrum | null {
  const meta: Record<string, string> = {}
  const xs: number[] = []
  const ys: number[] = []

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue

    if (line.startsWith('##')) {
      const kv = line.slice(2)
      const eq = kv.indexOf('=')
      if (eq > 0) {
        const key = kv.slice(0, eq).trim()
        const value = kv.slice(eq + 1).trim()
        if (key) meta[key] = value
      }
      continue
    }
    if (line.startsWith('#')) continue

    const parts = line.includes(',') ? line.split(',') : line.split(/\s+/)
    if (parts.length < 2) continue
    const a = Number(parts[0].trim())
    const b = Number(parts[1].trim())
    if (Number.isFinite(a) && Number.isFinite(b)) {
      xs.push(a)
      ys.push(b)
    }
  }

  if (xs.length < 2) return null

  return {
    x: xs,
    y: ys,
    xLabel: 'Raman Shift (cm\u207B\u00B9)',
    yLabel: 'Intensity',
    technique: 'Raman',
    metadata: {
      instrument: meta['INSTRUMENT'] || meta['Instrument'] || undefined,
      sampleName: meta['NAMES'] || meta['NAME'] || meta['SAMPLE'] || undefined,
      date: meta['DATE'] || meta['DATE_MEASURED'] || undefined,
      sourceFile,
      format: 'RRUFF',
    },
  }
}
