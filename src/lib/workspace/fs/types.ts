export type LatticeFileKind =
  | 'spectrum'
  | 'chat'
  | 'peakfit'
  | 'xrd'
  | 'xps'
  | 'raman'
  | 'curve'
  | 'workbench'
  | 'cif'
  | 'script'
  | 'markdown'
  | 'job'
  // Phase 7a — agent orchestrator artifact kinds. The renderer does not
  // yet write these; extensions are reserved so Phase 7c tool migrations
  // can emit envelopes without re-threading the file-kind map later.
  | 'research-report'
  | 'hypothesis'
  | 'paper'
  | 'material-comp'
  | 'knowledge'
  | 'batch'
  | 'optimization'
  | 'similarity'
  | 'structure-meta'
  | 'latex-document'
  | 'pdf'
  | 'image'
  | 'csv'
  | 'text'
  | 'tex'
  | 'bib'
  | 'spectral-data'
  | 'xrd-data'
  | 'json'
  | 'unknown'

export interface FsEntry {
  name: string
  relPath: string
  parentRel: string
  isDirectory: boolean
  size: number
  mtime: number
  kind?: LatticeFileKind
}

export interface FsStat {
  relPath: string
  isDirectory: boolean
  size: number
  mtime: number
  exists: boolean
}

export type WatchEvent =
  | { type: 'add'; relPath: string; isDirectory: boolean }
  | { type: 'change'; relPath: string }
  | { type: 'unlink'; relPath: string; isDirectory: boolean }
  | { type: 'ready' }
