export type SampleId = string

export type DataType =
  | 'spectrum'
  | 'analysis'
  | 'image'
  | 'paper'
  | 'structure'
  | 'compute'
  | 'report'
  | 'note'
  | 'other'

export interface Sample {
  id: SampleId
  name: string
  formula?: string
  preparation?: string
  substrate?: string
  morphology?: string
  tags: string[]
  notes: string
  files: string[]
  createdAt: number
  updatedAt: number
}

export interface ExperimentConditions {
  instrument?: string
  radiation?: string
  voltage?: string
  current?: string
  scanRange?: string
  stepSize?: string
  dwellTime?: string
  temperature?: string
  atmosphere?: string
  laserWavelength?: string
  laserPower?: string
  passEnergy?: string
  spotSize?: string
  [key: string]: string | undefined
}

export interface ImageInfo {
  magnification?: string
  acceleratingVoltage?: string
  detector?: string
  scalebar?: string
}

export interface PaperInfo {
  title?: string
  authors?: string
  year?: number
  doi?: string
  journal?: string
  abstract?: string
}

export interface FileMeta {
  sampleId?: string
  dataType: DataType
  technique?: string
  tags: string[]
  rating?: 1 | 2 | 3 | 4 | 5
  experimentConditions?: ExperimentConditions
  imageInfo?: ImageInfo
  paperInfo?: PaperInfo
  linkedFiles: string[]
  linkedPapers: string[]
  importedAt: number
  lastViewedAt?: number
}

export interface DataIndex {
  version: 1
  samples: Record<SampleId, Sample>
  tags: string[]
  fileMeta: Record<string, FileMeta>
}

export type GroupBy = 'sample' | 'technique' | 'type' | 'tag' | 'date' | 'folder'

export function emptyDataIndex(): DataIndex {
  return { version: 1, samples: {}, tags: [], fileMeta: {} }
}

export function emptyFileMeta(dataType: DataType = 'other'): FileMeta {
  return {
    dataType,
    tags: [],
    linkedFiles: [],
    linkedPapers: [],
    importedAt: Date.now(),
  }
}

export function inferDataType(technique?: string, fileKind?: string): DataType {
  if (fileKind === 'spectrum' || fileKind === 'spectral-data' || fileKind === 'xrd-data') return 'spectrum'
  if (fileKind === 'peakfit' || fileKind === 'xrd' || fileKind === 'xps' || fileKind === 'raman' || fileKind === 'curve' || fileKind === 'workbench') return 'analysis'
  if (fileKind === 'image') return 'image'
  if (fileKind === 'pdf') return 'paper'
  if (fileKind === 'cif' || fileKind === 'structure-meta') return 'structure'
  if (fileKind === 'script') return 'compute'
  if (fileKind === 'markdown' || fileKind === 'tex' || fileKind === 'latex-document') return 'report'
  if (fileKind === 'chat') return 'note'
  return 'other'
}
