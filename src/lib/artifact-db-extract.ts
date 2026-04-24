import type { Artifact } from '../types/artifact'
import type { MentionElementKind } from '../types/mention'

interface ExtractionResult {
  payload: unknown
  label: string
  sizeEstimate: number
}

function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value)
    } catch {
      // fall through
    }
  }
  return JSON.parse(JSON.stringify(value)) as T
}

function estimateSize(payload: unknown): number {
  try {
    return JSON.stringify(payload).length
  } catch {
    return 0
  }
}

export function extractElement(
  artifact: Artifact,
  elementKind: MentionElementKind,
  elementId: string,
): ExtractionResult | null {
  switch (elementKind) {
    case 'peak':
      return extractPeak(artifact, elementId)
    case 'phase':
      return extractPhase(artifact, elementId)
    case 'xps-fit':
      return extractXpsFit(artifact, elementId)
    case 'xps-component':
      return extractXpsComponent(artifact, elementId)
    case 'xps-quant-row':
      return extractXpsQuantRow(artifact, elementId)
    case 'raman-match':
      return extractRamanMatch(artifact, elementId)
    default:
      return extractGeneric(artifact, elementKind, elementId)
  }
}

function extractPeak(
  artifact: Artifact,
  elementId: string,
): ExtractionResult | null {
  if (artifact.kind !== 'peak-fit') return null
  const p = artifact.payload as {
    peaks: Array<{ id?: string; index: number; label?: string; position: number; fwhm?: number; area?: number }>
    algorithm?: string
    spectrumId?: string
  }
  const peak = p.peaks.find(
    (pk) =>
      pk.id === elementId ||
      `peak_${pk.index}` === elementId,
  )
  if (!peak) return null
  const payload = deepClone({
    peak,
    algorithm: p.algorithm,
    spectrumId: p.spectrumId,
  })
  return {
    payload,
    label: peak.label || `Peak ${peak.index + 1} @ ${peak.position.toFixed(2)}`,
    sizeEstimate: estimateSize(payload),
  }
}

function extractPhase(
  artifact: Artifact,
  elementId: string,
): ExtractionResult | null {
  if (artifact.kind !== 'xrd-analysis') return null
  const p = artifact.payload as {
    phases: Array<{ id: string; name: string; formula: string; confidence: number }>
  }
  const phase = p.phases.find((ph) => ph.id === elementId)
  if (!phase) return null
  const payload = deepClone({ phase })
  return {
    payload,
    label: phase.name || phase.formula,
    sizeEstimate: estimateSize(payload),
  }
}

function extractXpsFit(
  artifact: Artifact,
  elementId: string,
): ExtractionResult | null {
  if (artifact.kind !== 'xps-analysis') return null
  const p = artifact.payload as {
    fits: Array<{ id?: string; element: string; line: string; peaks: unknown[] }>
  }
  const idx = p.fits.findIndex(
    (f, i) => f.id === elementId || `fit_${i}` === elementId,
  )
  if (idx < 0) return null
  const fit = p.fits[idx]
  const payload = deepClone({ fit })
  return {
    payload,
    label: `${fit.element} ${fit.line}`,
    sizeEstimate: estimateSize(payload),
  }
}

function extractXpsComponent(
  artifact: Artifact,
  elementId: string,
): ExtractionResult | null {
  if (artifact.kind !== 'xps-analysis') return null
  const p = artifact.payload as {
    fits: Array<{
      element: string
      line: string
      peaks: Array<{ id?: string; label?: string; binding: number; fwhm: number }>
    }>
  }
  for (let fi = 0; fi < p.fits.length; fi++) {
    const fit = p.fits[fi]
    for (let pi = 0; pi < fit.peaks.length; pi++) {
      const peak = fit.peaks[pi]
      if (
        peak.id === elementId ||
        `xp_${fi}_${pi}` === elementId
      ) {
        const payload = deepClone({
          peak,
          fitElement: fit.element,
          fitLine: fit.line,
        })
        return {
          payload,
          label: `${fit.element} ${fit.line}: ${peak.label || 'component'}`,
          sizeEstimate: estimateSize(payload),
        }
      }
    }
  }
  return null
}

function extractXpsQuantRow(
  artifact: Artifact,
  elementId: string,
): ExtractionResult | null {
  if (artifact.kind !== 'xps-analysis') return null
  const p = artifact.payload as {
    quantification: Array<{ element: string; atomicPercent: number; relativeSensitivity: number }>
  }
  const rows = p.quantification ?? []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (
      elementId === row.element ||
      elementId === `quant_${i}` ||
      elementId === `xps_quant_${i}`
    ) {
      const payload = deepClone({ row })
      return {
        payload,
        label: `${row.element} ${row.atomicPercent.toFixed(2)} at%`,
        sizeEstimate: estimateSize(payload),
      }
    }
  }
  return null
}

function extractRamanMatch(
  artifact: Artifact,
  elementId: string,
): ExtractionResult | null {
  if (artifact.kind !== 'raman-id') return null
  const p = artifact.payload as {
    matches: Array<{ id: string; mineralName: string; formula: string; cosineScore: number }>
  }
  const match = p.matches.find((m) => m.id === elementId)
  if (!match) return null
  const payload = deepClone({ match })
  return {
    payload,
    label: `${match.mineralName} (${(match.cosineScore * 100).toFixed(1)}%)`,
    sizeEstimate: estimateSize(payload),
  }
}

function extractGeneric(
  artifact: Artifact,
  elementKind: MentionElementKind,
  elementId: string,
): ExtractionResult | null {
  const payload = deepClone({
    elementKind,
    elementId,
    artifactKind: artifact.kind,
    artifactTitle: artifact.title,
  })
  return {
    payload,
    label: `${elementKind}:${elementId}`,
    sizeEstimate: estimateSize(payload),
  }
}
