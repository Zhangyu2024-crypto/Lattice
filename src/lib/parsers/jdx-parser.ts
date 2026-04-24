import type { ParsedSpectrum, SpectroscopyTechnique } from './types'
import {
  classifyTechniqueFromText,
  defaultLabelsFor,
} from './technique-classifier'

const LABEL_RE = /^##([A-Z0-9 /._-]+?)\s*=\s*(.*)/i

function detectTechnique(
  dataType: string,
  xUnits: string,
  title: string,
): SpectroscopyTechnique {
  return classifyTechniqueFromText(`${dataType} ${xUnits} ${title}`)
}

function guessLabels(
  technique: SpectroscopyTechnique,
  xUnits: string,
  yUnits: string,
): { xLabel: string; yLabel: string } {
  // Explicit JCAMP units win over the technique defaults.
  if (xUnits && yUnits) return { xLabel: xUnits, yLabel: yUnits }
  const fallback = defaultLabelsFor(technique)
  return {
    xLabel: xUnits || fallback.xLabel,
    yLabel: yUnits || fallback.yLabel,
  }
}

function decodeXYData(block: string, firstX: number, lastX: number, nPoints: number): number[] | null {
  const lines = block.split(/\r?\n/).filter((l) => l.trim())
  const values: number[] = []
  for (const line of lines) {
    const tokens = line.trim().split(/[\s,;]+/)
    for (const t of tokens) {
      const n = Number(t)
      if (Number.isFinite(n)) values.push(n)
    }
  }
  if (values.length === 0) return null
  return values
}

function decodeXYPairs(block: string): { x: number[]; y: number[] } | null {
  const lines = block.split(/\r?\n/).filter((l) => l.trim())
  const x: number[] = []
  const y: number[] = []
  for (const line of lines) {
    const tokens = line.trim().split(/[\s,;]+/)
    if (tokens.length >= 2) {
      const a = Number(tokens[0])
      const b = Number(tokens[1])
      if (Number.isFinite(a) && Number.isFinite(b)) {
        x.push(a)
        y.push(b)
      }
    }
  }
  return x.length >= 2 ? { x, y } : null
}

export function parseJdx(text: string, sourceFile: string): ParsedSpectrum | null {
  const labels: Record<string, string> = {}
  let dataBlock = ''
  let inData = false
  let dataType: 'xydata' | 'xypairs' | 'peak' = 'xydata'

  for (const line of text.split(/\r?\n/)) {
    const m = line.match(LABEL_RE)
    if (m) {
      const key = m[1].trim().toUpperCase().replace(/\s+/g, ' ')
      const val = m[2].trim()

      if (key === 'XYDATA' || key === 'DATA TABLE') {
        inData = true
        dataType = 'xydata'
        continue
      }
      if (key === 'XYPAIRS' || key === 'XYPOINTS') {
        inData = true
        dataType = 'xypairs'
        continue
      }
      if (key === 'PEAK TABLE') {
        inData = true
        dataType = 'peak'
        continue
      }
      if (key === 'END') {
        inData = false
        continue
      }

      labels[key] = val
      continue
    }

    if (inData) {
      dataBlock += line + '\n'
    }
  }

  const firstX = Number(labels['FIRSTX'] ?? labels['FIRST X'])
  const lastX = Number(labels['LASTX'] ?? labels['LAST X'])
  const nPoints = Number(labels['NPOINTS'])
  const xFactor = Number(labels['XFACTOR']) || 1
  const yFactor = Number(labels['YFACTOR']) || 1

  let x: number[]
  let y: number[]

  if (dataType === 'xypairs' || dataType === 'peak') {
    const pairs = decodeXYPairs(dataBlock)
    if (!pairs) return null
    x = pairs.x.map((v) => v * xFactor)
    y = pairs.y.map((v) => v * yFactor)
  } else {
    if (Number.isFinite(firstX) && Number.isFinite(lastX) && nPoints > 1) {
      const raw = decodeXYData(dataBlock, firstX, lastX, nPoints)
      if (!raw || raw.length === 0) return null

      const lines = dataBlock.split(/\r?\n/).filter((l) => l.trim())
      const firstLine = lines[0]?.trim().split(/[\s,;]+/) ?? []
      const firstToken = Number(firstLine[0])
      const hasXColumn = firstLine.length > 1 && Math.abs(firstToken - firstX) < Math.abs(firstX) * 0.01 + 0.001

      if (hasXColumn) {
        const pairs = decodeXYPairs(dataBlock)
        if (pairs && pairs.x.length >= 2) {
          x = pairs.x.map((v) => v * xFactor)
          y = pairs.y.map((v) => v * yFactor)
        } else {
          return null
        }
      } else {
        y = raw.map((v) => v * yFactor)
        const dx = (lastX - firstX) / (nPoints - 1)
        x = Array.from({ length: y.length }, (_, i) => (firstX + i * dx) * xFactor)
      }
    } else {
      const pairs = decodeXYPairs(dataBlock)
      if (!pairs) return null
      x = pairs.x.map((v) => v * xFactor)
      y = pairs.y.map((v) => v * yFactor)
    }
  }

  if (x.length < 2) return null

  const titleRaw = labels['TITLE'] ?? labels['SAMPLE DESCRIPTION'] ?? ''
  const dataTypeStr = labels['DATA TYPE'] ?? ''
  const xUnits = labels['XUNITS'] ?? ''
  const yUnits = labels['YUNITS'] ?? ''
  const technique = detectTechnique(dataTypeStr, xUnits, titleRaw)
  const { xLabel, yLabel } = guessLabels(technique, xUnits, yUnits)

  return {
    x,
    y,
    xLabel,
    yLabel,
    technique,
    metadata: {
      instrument: labels['SPECTROMETER/DATA SYSTEM'] || labels['SOURCE REFERENCE'] || undefined,
      date: labels['LONG DATE'] || labels['DATE'] || undefined,
      sampleName: titleRaw || undefined,
      sourceFile,
      format: 'JCAMP-DX',
    },
  }
}
