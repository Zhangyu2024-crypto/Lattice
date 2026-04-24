import type { ParsedSpectrum, SpectroscopyTechnique } from '../../../../lib/parsers/types'

/**
 * Pure helpers shared by all spectral-data editor variants.
 * Extracted from SpectralDataEditor.tsx; no behavior change.
 */

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

export function toArrayBuffer(data: unknown): ArrayBuffer | null {
  if (data instanceof ArrayBuffer) return data
  if (data instanceof Uint8Array)
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  if (ArrayBuffer.isView(data)) {
    const v = data as unknown as {
      buffer: ArrayBuffer
      byteOffset: number
      byteLength: number
    }
    return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)
  }
  if (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    (data as { type: string }).type === 'Buffer' &&
    'data' in data
  ) {
    const arr = (data as { data: number[] }).data
    const u8 = new Uint8Array(arr)
    return u8.buffer as ArrayBuffer
  }
  return null
}

export const TECHNIQUE_MAP: Record<string, SpectroscopyTechnique> = {
  xrd: 'XRD',
  xps: 'XPS',
  raman: 'Raman',
  ftir: 'FTIR',
  curve: 'Curve',
}

export function backendResponseToSpectrum(
  data: {
    x?: number[]
    y?: number[]
    type?: string
    x_label?: string
    y_label?: string
    file?: string
    metadata?: Record<string, string>
  },
  relPath: string,
): ParsedSpectrum | null {
  if (!data.x?.length || !data.y?.length) return null
  const technique = TECHNIQUE_MAP[data.type?.toLowerCase() ?? ''] ?? 'Curve'
  const defaultXLabel =
    technique === 'XRD'
      ? '2\u03B8 (\u00B0)'
      : technique === 'Raman'
        ? 'Raman Shift (cm\u207B\u00B9)'
        : technique === 'XPS'
          ? 'Binding Energy (eV)'
          : 'X'
  return {
    x: data.x,
    y: data.y,
    xLabel: data.x_label || defaultXLabel,
    yLabel: data.y_label || 'Intensity',
    technique,
    metadata: {
      sourceFile: relPath,
      format: `${data.type ?? 'unknown'} (backend)`,
      ...(data.metadata?.instrument ? { instrument: data.metadata.instrument } : {}),
      ...(data.metadata?.sample_name ? { sampleName: data.metadata.sample_name } : {}),
    },
  }
}
