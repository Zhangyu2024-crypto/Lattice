export type SpectroscopyTechnique = 'XRD' | 'XPS' | 'Raman' | 'FTIR' | 'Curve'

export interface ParsedSpectrum {
  x: number[]
  y: number[]
  xLabel: string
  yLabel: string
  technique: SpectroscopyTechnique
  metadata: {
    instrument?: string
    date?: string
    sampleName?: string
    sourceFile: string
    format: string
  }
}
