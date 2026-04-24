import type { LatticeFileKind } from './fs/types'

// Keep ordering: multi-segment suffixes (e.g. `.structure.meta.json`) must
// be matched before their generic parent (`.json`) so a structure-meta file
// is not classified as `unknown`.
const EXTENSION_MAP: ReadonlyArray<readonly [string, LatticeFileKind]> = [
  ['.spectrum.json', 'spectrum'],
  ['.chat.json', 'chat'],
  ['.peakfit.json', 'peakfit'],
  ['.xrd.json', 'xrd'],
  ['.xps.json', 'xps'],
  ['.raman.json', 'raman'],
  ['.curve.json', 'curve'],
  ['.workbench.json', 'workbench'],
  ['.job.json', 'job'],
  ['.research-report.json', 'research-report'],
  ['.hypothesis.json', 'hypothesis'],
  ['.paper.json', 'paper'],
  ['.material-comp.json', 'material-comp'],
  ['.knowledge.json', 'knowledge'],
  ['.batch.json', 'batch'],
  ['.optimization.json', 'optimization'],
  ['.similarity.json', 'similarity'],
  ['.structure.meta.json', 'structure-meta'],
  ['.latex.json', 'latex-document'],
  ['.cif', 'cif'],
  ['.pdf', 'pdf'],
  ['.py', 'script'],
  ['.md', 'markdown'],
  ['.png', 'image'],
  ['.jpg', 'image'],
  ['.jpeg', 'image'],
  ['.gif', 'image'],
  ['.svg', 'image'],
  ['.webp', 'image'],
  ['.csv', 'csv'],
  ['.tsv', 'csv'],
  ['.tex', 'tex'],
  ['.bib', 'bib'],
  ['.xy', 'spectral-data'],
  ['.jdx', 'spectral-data'],
  ['.dx', 'spectral-data'],
  ['.spc', 'spectral-data'],
  ['.wdf', 'spectral-data'],
  ['.vms', 'spectral-data'],
  ['.vamas', 'spectral-data'],
  ['.spe', 'spectral-data'],
  ['.npl', 'spectral-data'],
  ['.spa', 'spectral-data'],
  ['.sp', 'spectral-data'],
  ['.cha', 'spectral-data'],
  ['.rruf', 'spectral-data'],
  ['.ngs', 'spectral-data'],
  ['.raw', 'xrd-data'],
  ['.chi', 'xrd-data'],
  ['.uxd', 'xrd-data'],
  ['.xrdml', 'xrd-data'],
  ['.rd', 'xrd-data'],
  ['.sd', 'xrd-data'],
  ['.gsa', 'xrd-data'],
  ['.fxye', 'xrd-data'],
  ['.cpi', 'xrd-data'],
  ['.udf', 'xrd-data'],
  ['.txt', 'text'],
  ['.dat', 'text'],
  ['.log', 'text'],
  ['.json', 'json'],
]

const KIND_EXTENSION: Readonly<Record<LatticeFileKind, string | null>> = {
  spectrum: '.spectrum.json',
  chat: '.chat.json',
  peakfit: '.peakfit.json',
  xrd: '.xrd.json',
  xps: '.xps.json',
  raman: '.raman.json',
  curve: '.curve.json',
  workbench: '.workbench.json',
  job: '.job.json',
  'research-report': '.research-report.json',
  hypothesis: '.hypothesis.json',
  paper: '.paper.json',
  'material-comp': '.material-comp.json',
  knowledge: '.knowledge.json',
  batch: '.batch.json',
  optimization: '.optimization.json',
  similarity: '.similarity.json',
  'structure-meta': '.structure.meta.json',
  'latex-document': '.latex.json',
  cif: '.cif',
  pdf: '.pdf',
  script: '.py',
  markdown: '.md',
  image: '.png',
  csv: '.csv',
  text: '.txt',
  tex: '.tex',
  bib: '.bib',
  'spectral-data': '.xy',
  'xrd-data': '.raw',
  json: '.json',
  unknown: null,
}

export function fileKindFromName(name: string): LatticeFileKind {
  const lower = name.toLowerCase()
  for (const [ext, kind] of EXTENSION_MAP) {
    if (lower.endsWith(ext)) return kind
  }
  return 'unknown'
}

/** Canonical extension (including the leading dot) for a file kind, or null
 *  when the kind has no stable on-disk representation (e.g. `unknown`).
 *  Used by the orchestrator's `emitArtifact` to derive a filename from a
 *  kind + basename. */
export function extensionForKind(kind: LatticeFileKind): string | null {
  return KIND_EXTENSION[kind] ?? null
}
