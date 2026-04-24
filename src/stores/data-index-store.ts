import { create } from 'zustand'
import { getWorkspaceFs } from '@/lib/workspace/fs'
import { readEnvelope } from '@/lib/workspace/envelope'
import { fileKindFromName } from '@/lib/workspace/file-kind'
import type { FsEntry } from '@/lib/workspace/fs/types'
import type {
  DataIndex,
  DataType,
  ExperimentConditions,
  FileMeta,
  GroupBy,
  Sample,
  SampleId,
} from '@/types/data-index'
import { emptyDataIndex, emptyFileMeta, inferDataType } from '@/types/data-index'

const INDEX_PATH = '.lattice/data-index.json'
const SAVE_DEBOUNCE_MS = 500

function genSampleId(): SampleId {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = 'sam-'
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)]
  return id
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void useDataIndexStore.getState().save()
  }, SAVE_DEBOUNCE_MS)
}

function ensureMeta(
  fileMeta: Record<string, FileMeta>,
  relPath: string,
): Record<string, FileMeta> {
  if (fileMeta[relPath]) return fileMeta
  const kind = fileKindFromName(relPath.split('/').pop() ?? relPath)
  return { ...fileMeta, [relPath]: emptyFileMeta(inferDataType(undefined, kind)) }
}

function normalizeTechnique(raw: string): string {
  const upper = raw.toUpperCase()
  if (['XRD', 'XPS', 'FTIR', 'SEM', 'TEM', 'EDS', 'AFM', 'STM'].includes(upper)) return upper
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

// ── Standalone derived functions (consumed by UI via useMemo) ──────────

export interface DataStats {
  totalFiles: number
  spectra: number
  spectraByTechnique: Record<string, number>
  analyses: number
  images: number
  papers: number
  structures: number
  compute: number
  reports: number
  samples: number
  tags: number
  rated: number
  assigned: number
}

export function getStats(index: DataIndex, fileIndex: Record<string, FsEntry>): DataStats {
  const stats: DataStats = {
    totalFiles: 0, spectra: 0, spectraByTechnique: {}, analyses: 0,
    images: 0, papers: 0, structures: 0, compute: 0, reports: 0,
    samples: Object.keys(index.samples).length,
    tags: index.tags.length, rated: 0, assigned: 0,
  }
  for (const [rel, entry] of Object.entries(fileIndex)) {
    if (entry.isDirectory) continue
    stats.totalFiles++
    const fm = index.fileMeta[rel]
    if (!fm) continue
    if (fm.sampleId) stats.assigned++
    if (fm.rating) stats.rated++
    switch (fm.dataType) {
      case 'spectrum': {
        stats.spectra++
        const t = fm.technique ?? 'Unknown'
        stats.spectraByTechnique[t] = (stats.spectraByTechnique[t] ?? 0) + 1
        break
      }
      case 'analysis': stats.analyses++; break
      case 'image': stats.images++; break
      case 'paper': stats.papers++; break
      case 'structure': stats.structures++; break
      case 'compute': stats.compute++; break
      case 'report': stats.reports++; break
    }
  }
  return stats
}

export function getFilteredFiles(
  state: DataIndexState,
  fileIndex: Record<string, FsEntry>,
): FsEntry[] {
  const { index, searchQuery, filterTags, filterTechnique, filterDataType, filterRating } = state
  const q = searchQuery.toLowerCase().trim()
  const result: FsEntry[] = []

  for (const entry of Object.values(fileIndex)) {
    if (entry.isDirectory) continue
    const fm = index.fileMeta[entry.relPath]

    if (filterDataType && fm?.dataType !== filterDataType) continue
    if (filterTechnique && fm?.technique !== filterTechnique) continue
    if (filterRating && (!fm?.rating || fm.rating < filterRating)) continue
    if (filterTags.length > 0 && !filterTags.some((t) => fm?.tags?.includes(t))) continue

    if (q) {
      const name = entry.name.toLowerCase()
      const sampleName = fm?.sampleId ? (index.samples[fm.sampleId]?.name ?? '').toLowerCase() : ''
      const tags = (fm?.tags ?? []).join(' ').toLowerCase()
      const technique = (fm?.technique ?? '').toLowerCase()
      const paperTitle = (fm?.paperInfo?.title ?? '').toLowerCase()
      const paperAuthors = (fm?.paperInfo?.authors ?? '').toLowerCase()
      if (!name.includes(q) && !sampleName.includes(q) && !tags.includes(q) && !technique.includes(q) && !paperTitle.includes(q) && !paperAuthors.includes(q)) continue
    }

    result.push(entry)
  }

  result.sort((a, b) => a.name.localeCompare(b.name))
  return result
}

export function getGroupedFiles(
  state: DataIndexState,
  fileIndex: Record<string, FsEntry>,
): Map<string, FsEntry[]> {
  const filtered = getFilteredFiles(state, fileIndex)
  const { index, groupBy } = state
  const groups = new Map<string, FsEntry[]>()

  for (const entry of filtered) {
    const fm = index.fileMeta[entry.relPath]
    let keys: string[]

    switch (groupBy) {
      case 'sample': {
        const sid = fm?.sampleId
        const sample = sid ? index.samples[sid] : null
        keys = [sample ? `${sample.name}` : 'Unassigned']
        break
      }
      case 'technique':
        keys = [fm?.technique ?? 'Other']
        break
      case 'type':
        keys = [fm?.dataType ?? 'other']
        break
      case 'tag':
        keys = fm?.tags?.length ? fm.tags : ['Untagged']
        break
      case 'date': {
        const d = new Date(entry.mtime)
        keys = [`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`]
        break
      }
      case 'folder':
        keys = [entry.parentRel || '/']
        break
      default:
        keys = ['Other']
    }

    for (const key of keys) {
      const arr = groups.get(key) ?? []
      arr.push(entry)
      groups.set(key, arr)
    }
  }

  return groups
}

// ── Store ──────────────────────────────────────────────────────────────

export interface DataIndexState {
  index: DataIndex
  loaded: boolean
  searchQuery: string
  groupBy: GroupBy
  filterTags: string[]
  filterTechnique: string | null
  filterDataType: DataType | null
  filterRating: number | null
  selectedFile: string | null
  selectedSample: string | null

  load: () => Promise<void>
  save: () => Promise<void>
  rebuildFromFileIndex: () => Promise<void>

  createSample: (name: string, formula?: string) => SampleId
  updateSample: (id: SampleId, patch: Partial<Sample>) => void
  renameSample: (id: SampleId, name: string) => void
  deleteSample: (id: SampleId) => void

  assignFileToSample: (relPath: string, sampleId: SampleId) => void
  removeFileFromSample: (relPath: string, sampleId: SampleId) => void

  addGlobalTag: (tag: string) => void
  removeGlobalTag: (tag: string) => void
  tagFile: (relPath: string, tag: string) => void
  untagFile: (relPath: string, tag: string) => void
  tagSample: (sampleId: SampleId, tag: string) => void
  untagSample: (sampleId: SampleId, tag: string) => void

  setFileMeta: (relPath: string, patch: Partial<FileMeta>) => void
  setRating: (relPath: string, rating: 1 | 2 | 3 | 4 | 5 | undefined) => void
  setExperimentConditions: (relPath: string, patch: Partial<ExperimentConditions>) => void
  linkFiles: (a: string, b: string) => void
  unlinkFiles: (a: string, b: string) => void
  linkPaper: (fileRel: string, paperRel: string) => void

  autoDetectFile: (relPath: string) => Promise<void>

  setSearchQuery: (q: string) => void
  setGroupBy: (g: GroupBy) => void
  setFilterTags: (t: string[]) => void
  setFilterTechnique: (t: string | null) => void
  setFilterDataType: (t: DataType | null) => void
  setFilterRating: (r: number | null) => void
  setSelectedFile: (relPath: string | null) => void
  setSelectedSample: (id: string | null) => void
}

export const useDataIndexStore = create<DataIndexState>((set, get) => ({
  index: emptyDataIndex(),
  loaded: false,
  searchQuery: '',
  groupBy: 'sample',
  filterTags: [],
  filterTechnique: null,
  filterDataType: null,
  filterRating: null,
  selectedFile: null,
  selectedSample: null,

  load: async () => {
    const fs = getWorkspaceFs()
    if (!fs.rootPath) { set({ index: emptyDataIndex(), loaded: true }); return }
    try {
      if (!(await fs.exists(INDEX_PATH))) { set({ index: emptyDataIndex(), loaded: true }); return }
      const raw = await fs.readJson<unknown>(INDEX_PATH)
      if (typeof raw === 'object' && raw !== null && 'version' in raw && (raw as DataIndex).version === 1) {
        const p = raw as DataIndex
        set({ index: { version: 1, samples: p.samples ?? {}, tags: Array.isArray(p.tags) ? p.tags : [], fileMeta: p.fileMeta ?? {} }, loaded: true })
      } else {
        set({ index: emptyDataIndex(), loaded: true })
      }
    } catch { set({ index: emptyDataIndex(), loaded: true }) }
  },

  save: async () => {
    const fs = getWorkspaceFs()
    if (!fs.rootPath) return
    try {
      if (!(await fs.exists('.lattice'))) await fs.mkdir('.lattice')
      await fs.writeJson(INDEX_PATH, get().index)
    } catch { /* retry on next debounce */ }
  },

  rebuildFromFileIndex: async () => {
    const { useWorkspaceStore } = await import('./workspace-store')
    const fileIndex = useWorkspaceStore.getState().fileIndex
    const { index } = get()
    const newFileMeta = { ...index.fileMeta }
    let changed = false

    for (const entry of Object.values(fileIndex)) {
      if (entry.isDirectory) continue
      if (!newFileMeta[entry.relPath]) {
        const kind = fileKindFromName(entry.name)
        newFileMeta[entry.relPath] = emptyFileMeta(inferDataType(undefined, kind))
        changed = true
      }
    }

    for (const rel of Object.keys(newFileMeta)) {
      if (!fileIndex[rel]) {
        delete newFileMeta[rel]
        changed = true
      }
    }

    const newSamples = { ...index.samples }
    for (const [id, sample] of Object.entries(newSamples)) {
      const cleaned = sample.files.filter((f) => fileIndex[f])
      if (cleaned.length !== sample.files.length) {
        newSamples[id] = { ...sample, files: cleaned }
        changed = true
      }
    }

    if (changed) {
      set({ index: { ...index, samples: newSamples, fileMeta: newFileMeta } })
      scheduleSave()
    }

    for (const entry of Object.values(fileIndex)) {
      if (entry.isDirectory) continue
      const fm = newFileMeta[entry.relPath]
      if (fm && !fm.technique && (fm.dataType === 'spectrum' || fm.dataType === 'other')) {
        void get().autoDetectFile(entry.relPath)
      }
    }
  },

  createSample: (name, formula) => {
    const id = genSampleId()
    const now = Date.now()
    set((s) => ({
      index: {
        ...s.index,
        samples: { ...s.index.samples, [id]: { id, name, formula, tags: [], notes: '', files: [], createdAt: now, updatedAt: now } },
      },
    }))
    scheduleSave()
    return id
  },

  updateSample: (id, patch) => {
    set((s) => {
      const sample = s.index.samples[id]
      if (!sample) return {}
      return { index: { ...s.index, samples: { ...s.index.samples, [id]: { ...sample, ...patch, updatedAt: Date.now() } } } }
    })
    scheduleSave()
  },

  renameSample: (id, name) => get().updateSample(id, { name }),

  deleteSample: (id) => {
    set((s) => {
      const { [id]: removed, ...rest } = s.index.samples
      if (!removed) return {}
      const fileMeta = { ...s.index.fileMeta }
      for (const relPath of removed.files) {
        const fm = fileMeta[relPath]
        if (fm?.sampleId === id) fileMeta[relPath] = { ...fm, sampleId: undefined }
      }
      return { index: { ...s.index, samples: rest, fileMeta } }
    })
    scheduleSave()
  },

  assignFileToSample: (relPath, sampleId) => {
    set((s) => {
      const sample = s.index.samples[sampleId]
      if (!sample) return {}
      const files = sample.files.includes(relPath) ? sample.files : [...sample.files, relPath]
      const fileMeta = ensureMeta(s.index.fileMeta, relPath)
      return {
        index: {
          ...s.index,
          samples: { ...s.index.samples, [sampleId]: { ...sample, files, updatedAt: Date.now() } },
          fileMeta: { ...fileMeta, [relPath]: { ...fileMeta[relPath], sampleId } },
        },
      }
    })
    scheduleSave()
  },

  removeFileFromSample: (relPath, sampleId) => {
    set((s) => {
      const sample = s.index.samples[sampleId]
      if (!sample) return {}
      const fileMeta = { ...s.index.fileMeta }
      const fm = fileMeta[relPath]
      if (fm?.sampleId === sampleId) fileMeta[relPath] = { ...fm, sampleId: undefined }
      return {
        index: {
          ...s.index,
          samples: { ...s.index.samples, [sampleId]: { ...sample, files: sample.files.filter((f) => f !== relPath), updatedAt: Date.now() } },
          fileMeta,
        },
      }
    })
    scheduleSave()
  },

  addGlobalTag: (tag) => {
    set((s) => {
      if (s.index.tags.includes(tag)) return {}
      return { index: { ...s.index, tags: [...s.index.tags, tag] } }
    })
    scheduleSave()
  },

  removeGlobalTag: (tag) => {
    set((s) => ({ index: { ...s.index, tags: s.index.tags.filter((t) => t !== tag) } }))
    scheduleSave()
  },

  tagFile: (relPath, tag) => {
    set((s) => {
      const fileMeta = ensureMeta(s.index.fileMeta, relPath)
      const fm = fileMeta[relPath]
      if (fm.tags.includes(tag)) return {}
      const tags = s.index.tags.includes(tag) ? s.index.tags : [...s.index.tags, tag]
      return { index: { ...s.index, tags, fileMeta: { ...fileMeta, [relPath]: { ...fm, tags: [...fm.tags, tag] } } } }
    })
    scheduleSave()
  },

  untagFile: (relPath, tag) => {
    set((s) => {
      const fm = s.index.fileMeta[relPath]
      if (!fm) return {}
      return { index: { ...s.index, fileMeta: { ...s.index.fileMeta, [relPath]: { ...fm, tags: fm.tags.filter((t) => t !== tag) } } } }
    })
    scheduleSave()
  },

  tagSample: (sampleId, tag) => {
    set((s) => {
      const sample = s.index.samples[sampleId]
      if (!sample || sample.tags.includes(tag)) return {}
      const tags = s.index.tags.includes(tag) ? s.index.tags : [...s.index.tags, tag]
      return { index: { ...s.index, tags, samples: { ...s.index.samples, [sampleId]: { ...sample, tags: [...sample.tags, tag] } } } }
    })
    scheduleSave()
  },

  untagSample: (sampleId, tag) => {
    set((s) => {
      const sample = s.index.samples[sampleId]
      if (!sample) return {}
      return { index: { ...s.index, samples: { ...s.index.samples, [sampleId]: { ...sample, tags: sample.tags.filter((t) => t !== tag) } } } }
    })
    scheduleSave()
  },

  setFileMeta: (relPath, patch) => {
    set((s) => {
      const fileMeta = ensureMeta(s.index.fileMeta, relPath)
      return { index: { ...s.index, fileMeta: { ...fileMeta, [relPath]: { ...fileMeta[relPath], ...patch } } } }
    })
    scheduleSave()
  },

  setRating: (relPath, rating) => {
    get().setFileMeta(relPath, { rating })
  },

  setExperimentConditions: (relPath, patch) => {
    set((s) => {
      const fileMeta = ensureMeta(s.index.fileMeta, relPath)
      const fm = fileMeta[relPath]
      return {
        index: {
          ...s.index,
          fileMeta: { ...fileMeta, [relPath]: { ...fm, experimentConditions: { ...fm.experimentConditions, ...patch } } },
        },
      }
    })
    scheduleSave()
  },

  linkFiles: (a, b) => {
    set((s) => {
      const fm = ensureMeta(ensureMeta(s.index.fileMeta, a), b)
      const fmA = fm[a]
      const fmB = fm[b]
      const linksA = fmA.linkedFiles.includes(b) ? fmA.linkedFiles : [...fmA.linkedFiles, b]
      const linksB = fmB.linkedFiles.includes(a) ? fmB.linkedFiles : [...fmB.linkedFiles, a]
      return { index: { ...s.index, fileMeta: { ...fm, [a]: { ...fmA, linkedFiles: linksA }, [b]: { ...fmB, linkedFiles: linksB } } } }
    })
    scheduleSave()
  },

  unlinkFiles: (a, b) => {
    set((s) => {
      const fm = { ...s.index.fileMeta }
      const fmA = fm[a]
      const fmB = fm[b]
      if (fmA) fm[a] = { ...fmA, linkedFiles: fmA.linkedFiles.filter((f) => f !== b) }
      if (fmB) fm[b] = { ...fmB, linkedFiles: fmB.linkedFiles.filter((f) => f !== a) }
      return { index: { ...s.index, fileMeta: fm } }
    })
    scheduleSave()
  },

  linkPaper: (fileRel, paperRel) => {
    set((s) => {
      const fm = ensureMeta(ensureMeta(s.index.fileMeta, fileRel), paperRel)
      const fmFile = fm[fileRel]
      const fmPaper = fm[paperRel]
      return {
        index: {
          ...s.index,
          fileMeta: {
            ...fm,
            [fileRel]: { ...fmFile, linkedPapers: fmFile.linkedPapers.includes(paperRel) ? fmFile.linkedPapers : [...fmFile.linkedPapers, paperRel] },
            [paperRel]: { ...fmPaper, linkedPapers: fmPaper.linkedPapers.includes(fileRel) ? fmPaper.linkedPapers : [...fmPaper.linkedPapers, fileRel] },
          },
        },
      }
    })
    scheduleSave()
  },

  autoDetectFile: async (relPath) => {
    const kind = fileKindFromName(relPath.split('/').pop() ?? relPath)
    const dataType = inferDataType(undefined, kind)
    let technique: string | undefined

    if (kind === 'spectrum' || kind === 'spectral-data' || kind === 'xrd-data') {
      try {
        const fs = getWorkspaceFs()
        if (fs.rootPath && relPath.endsWith('.spectrum.json')) {
          const env = await readEnvelope<{ spectrumType?: string | null }>(fs, relPath)
          if (typeof env.payload?.spectrumType === 'string' && env.payload.spectrumType) {
            technique = normalizeTechnique(env.payload.spectrumType)
          }
        }
      } catch { /* non-fatal */ }
    }

    get().setFileMeta(relPath, { dataType, ...(technique ? { technique } : {}) })
  },

  setSearchQuery: (q) => set({ searchQuery: q }),
  setGroupBy: (g) => set({ groupBy: g }),
  setFilterTags: (t) => set({ filterTags: t }),
  setFilterTechnique: (t) => set({ filterTechnique: t }),
  setFilterDataType: (t) => set({ filterDataType: t }),
  setFilterRating: (r) => set({ filterRating: r }),
  setSelectedFile: (relPath) => set({ selectedFile: relPath, selectedSample: null }),
  setSelectedSample: (id) => set({ selectedSample: id, selectedFile: null }),
}))
