import type { ParsedSpectrum } from './types'

function textOf(el: Element, tag: string): string | null {
  const child = el.getElementsByTagName(tag)[0]
  return child?.textContent?.trim() ?? null
}

function floatsOf(el: Element, tag: string): number[] | null {
  const raw = textOf(el, tag)
  if (!raw) return null
  return raw.split(/\s+/).map(Number).filter(Number.isFinite)
}

export function parseXrdml(xmlText: string, sourceFile: string): ParsedSpectrum | null {
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(xmlText, 'text/xml')
  } catch {
    return null
  }

  const parseError = doc.getElementsByTagName('parsererror')[0]
  if (parseError) return null

  const scans = doc.getElementsByTagName('dataPoints')
  if (scans.length === 0) return null
  const dp = scans[0]

  const intensities =
    floatsOf(dp, 'intensities') ??
    floatsOf(dp, 'counts') ??
    floatsOf(dp, 'countRateCorrection')

  if (!intensities || intensities.length < 2) return null

  let x: number[]

  const positionsEl = dp.getElementsByTagName('positions')[0]
  if (positionsEl) {
    const startVal = textOf(positionsEl, 'startPosition')
    const endVal = textOf(positionsEl, 'endPosition')
    if (startVal && endVal) {
      const start = Number(startVal)
      const end = Number(endVal)
      if (Number.isFinite(start) && Number.isFinite(end) && intensities.length > 1) {
        const step = (end - start) / (intensities.length - 1)
        x = Array.from({ length: intensities.length }, (_, i) => start + i * step)
      } else {
        return null
      }
    } else {
      const listed = floatsOf(positionsEl, 'listPositions')
      if (listed && listed.length === intensities.length) {
        x = listed
      } else {
        return null
      }
    }
  } else {
    return null
  }

  const axisAttr = positionsEl?.getAttribute('axis') ?? ''
  const unit = positionsEl?.getAttribute('unit') ?? ''
  const isOmega = axisAttr.toLowerCase() === 'omega'
  const xLabel = isOmega ? '\u03C9 (\u00B0)' : `2\u03B8 (${unit || '\u00B0'})`

  const sampleName =
    textOf(doc.documentElement, 'sampleName') ??
    textOf(doc.documentElement, 'name') ??
    undefined

  const dateRaw =
    textOf(doc.documentElement, 'startTimeStamp') ??
    textOf(doc.documentElement, 'endTimeStamp') ??
    undefined

  return {
    x,
    y: intensities,
    xLabel,
    yLabel: 'Intensity (counts)',
    technique: 'XRD',
    metadata: {
      sampleName,
      date: dateRaw,
      sourceFile,
      format: 'PANalytical XRDML',
    },
  }
}
