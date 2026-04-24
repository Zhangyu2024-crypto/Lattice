import type { ParsedSpectrum, SpectroscopyTechnique } from './types'
import {
  classifyTechniqueFromText,
  defaultLabelsFor,
} from './technique-classifier'

function detectDelimiter(firstLines: string[]): string {
  const candidates = ['\t', ',', ';', /\s{2,}/]
  let best = ' '
  let bestCount = 0
  for (const delim of candidates) {
    const counts = firstLines.map(
      (l) => (typeof delim === 'string' ? l.split(delim) : l.split(delim)).length - 1,
    )
    const min = Math.min(...counts)
    if (min > bestCount) {
      bestCount = min
      best = typeof delim === 'string' ? delim : '  '
    }
  }
  return best
}

function isHeaderLine(line: string): boolean {
  const stripped = line.replace(/[\s,;\t]+/g, ' ').trim()
  const tokens = stripped.split(' ')
  const numericCount = tokens.filter((t) => Number.isFinite(Number(t))).length
  return numericCount < tokens.length * 0.5
}

function guessTechnique(
  headerTokens: string[],
  fileName: string,
): { technique: SpectroscopyTechnique; xLabel: string; yLabel: string } {
  const technique = classifyTechniqueFromText(
    [...headerTokens, fileName].join(' '),
  )
  return { technique, ...defaultLabelsFor(technique) }
}

export function parseCsv(
  text: string,
  sourceFile: string,
): ParsedSpectrum | null {
  const rawLines = text.split(/\r?\n/)
  const nonEmpty = rawLines.filter((l) => l.trim())
  if (nonEmpty.length < 3) return null

  let headerLines: string[] = []
  let dataStart = 0
  for (let i = 0; i < Math.min(nonEmpty.length, 20); i++) {
    if (nonEmpty[i].startsWith('#') || nonEmpty[i].startsWith('%')) {
      headerLines.push(nonEmpty[i])
      dataStart = i + 1
      continue
    }
    if (isHeaderLine(nonEmpty[i])) {
      headerLines.push(nonEmpty[i])
      dataStart = i + 1
      continue
    }
    break
  }

  const dataLines = nonEmpty.slice(dataStart)
  if (dataLines.length < 3) return null

  const sampleForDelim = dataLines.slice(0, Math.min(10, dataLines.length))
  const delim = detectDelimiter(sampleForDelim)

  const x: number[] = []
  const y: number[] = []

  for (const line of dataLines) {
    const parts =
      delim === '  '
        ? line.trim().split(/\s{2,}|\s+/)
        : line.trim().split(delim)
    if (parts.length < 2) continue
    const a = Number(parts[0].trim())
    const b = Number(parts[1].trim())
    if (Number.isFinite(a) && Number.isFinite(b)) {
      x.push(a)
      y.push(b)
    }
  }

  if (x.length < 3) return null

  const { technique, xLabel, yLabel } = guessTechnique(headerLines, sourceFile)

  return {
    x,
    y,
    xLabel,
    yLabel,
    technique,
    metadata: {
      sourceFile,
      format: sourceFile.match(/\.[^.]+$/)?.[0]?.toUpperCase().replace('.', '') ?? 'CSV',
    },
  }
}
