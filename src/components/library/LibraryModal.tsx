// LibraryModal — 3-pane reference library browser.
//
// Data source (Self-contained Port §P3 v2):
//   • `localProLibrary` — JSON file under userData/library/library.json,
//     always ready whenever the Electron shell is running
//   • the bundled demo data (`data` prop) as a read-only fallback otherwise
//     (pure-Vite dev mode)
//
// This mirrors pro.html's library view — collections sidebar, paper list
// with search + tag filter, detail pane. Write actions (DOI import, delete,
// tags, collections, bibtex/ris import, directory scan) now target the
// local facade; DOI lookup, BibTeX/RIS import/export and PDF scan surface
// an explicit "not implemented locally" toast until those pipelines land.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Loader2,
  MessageSquare,
  RefreshCw,
  Sparkles,
  Upload,
  X,
} from 'lucide-react'
import { toast } from '../../stores/toast-store'
import { downloadTextFile } from '../../lib/pro-export'
import { localProLibrary } from '../../lib/local-pro-library'
import {
  extractAllPapersToKnowledge,
  extractPaperToKnowledge,
} from '../../lib/knowledge/auto-extract'
import { asyncPrompt } from '../../lib/prompt-dialog'
import type {
  LibraryCollection as LibraryCollectionRow,
  LibraryPaperRow,
  LibraryStats,
  LibraryTag,
} from '../../types/library-api'
import type {
  LibraryCollection as DemoCollection,
  LibraryData,
  LibraryPaper as DemoPaper,
  PaperArtifactMetadata,
  PaperArtifactPayload,
} from '../../stores/demo-library'
import type { Artifact } from '../../types/artifact'
import {
  formatPaperArtifactTitle,
  paperReaderHeadline,
} from '../../lib/paper-metadata'
import PaperArtifactCard from '../canvas/artifacts/PaperArtifactCard'
import MultiPaperQAModal, { type PaperOption } from './MultiPaperQAModal'
import IconButton from '../ui/IconButton'
import CollectionsPane from './modal/CollectionsPane'
import MiddlePane from './modal/MiddlePane'
import DetailsPane from './modal/DetailsPane'
import Resizer from '../common/Resizer'
import { ALL_PAPERS_ID, type Collection, type PaperCard } from './modal/types'

interface LibraryModalProps {
  open: boolean
  onClose: () => void
  /** Demo data used only when the backend isn't ready. */
  data: LibraryData
  /** Called when the user clicks "Open" on a paper row — the caller
   *  decides whether to surface a PaperArtifact or a PDF viewer. */
  onOpenPaper: (
    paperId: string,
    metadata: PaperArtifactMetadata,
    abstract: string,
  ) => void
  /**
   * `standalone` = dedicated BrowserWindow (`#/library`). Opening a paper
   * shows the PDF reader in this window; use toolbar "Open in workspace"
   * to mirror the artifact in the main window via IPC.
   */
  presentation?: 'modal' | 'standalone'
}

function paperCardToReaderArtifact(paper: PaperCard): Artifact {
  const paperIdStr =
    paper.backendId != null ? String(paper.backendId) : paper.id
  const metadata: PaperArtifactMetadata = {
    title: paper.title,
    authors: paper.authors,
    year: Number(paper.year) || 0,
    venue: paper.venue,
    doi: paper.doi,
    abstract: paper.abstract,
  }
  const payload: PaperArtifactPayload = {
    paperId: paperIdStr,
    metadata,
    annotations: [],
    extractions: [],
    ...(paper.pdfUrl ? { pdfUrl: paper.pdfUrl } : {}),
  }
  return {
    id: `library-reader-${paper.id}`,
    kind: 'paper',
    title: formatPaperArtifactTitle(metadata.title, metadata.authors, metadata.doi),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    payload: payload as never,
  }
}

export default function LibraryModal({
  open,
  onClose,
  data,
  onOpenPaper,
  presentation = 'modal',
}: LibraryModalProps) {
  const api = localProLibrary
  // Single gate for all write actions (DOI import, scan, BibTeX/RIS, tags,
  // collections, export, multi-paper Q&A, refresh). Verified: every handler
  // / disabled / title gate in this file checks only `api.ready`; the
  // `usingBackend` predicate below is a separate data-source selector.
  const canEdit = api.ready
  const [collectionId, setCollectionId] = useState<string>(ALL_PAPERS_ID)
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [activeTags, setActiveTags] = useState<Set<string>>(() => new Set())
  const [doiInput, setDoiInput] = useState('')

  // Backend-fetched data (null when backend is not ready).
  const [backendPapers, setBackendPapers] = useState<PaperCard[] | null>(null)
  const [backendTags, setBackendTags] = useState<LibraryTag[] | null>(null)
  const [backendCollections, setBackendCollections] = useState<
    Collection[] | null
  >(null)
  const [stats, setStats] = useState<LibraryStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [extractProgress, setExtractProgress] = useState<{ done: number; total: number } | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [multiQaOpen, setMultiQaOpen] = useState(false)
  /** Standalone window only: in-window PDF reader (no jump to main workspace). */
  const [readerPaper, setReaderPaper] = useState<PaperCard | null>(null)
  // Resizable pane widths — persisted to localStorage so the user's
  // split is remembered between sessions.
  const [leftWidth, setLeftWidth] = useState<number>(() => {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('lattice.library.leftWidth') : null
    const n = raw ? Number(raw) : 220
    return Number.isFinite(n) ? Math.max(160, Math.min(400, n)) : 220
  })
  const [rightWidth, setRightWidth] = useState<number>(() => {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('lattice.library.rightWidth') : null
    const n = raw ? Number(raw) : 320
    return Number.isFinite(n) ? Math.max(240, Math.min(520, n)) : 320
  })

  // Hidden file inputs for the two importers.
  const bibtexInputRef = useRef<HTMLInputElement | null>(null)
  const risInputRef = useRef<HTMLInputElement | null>(null)
  const importDetailsRef = useRef<HTMLDetailsElement | null>(null)

  // ── Data source ──────────────────────────────────────────────

  const usingBackend = api.ready && backendPapers != null
  const demoPapers = useMemo<PaperCard[]>(
    () => data.papers.map(demoPaperToCard),
    [data.papers],
  )
  const demoCollections = useMemo<Collection[]>(
    () =>
      data.collections.map((c) => ({
        id: c.id,
        name: c.name,
        paperCount: c.paperCount,
      })),
    [data.collections],
  )

  const papers = usingBackend
    ? (backendPapers as PaperCard[])
    : demoPapers
  const collections = usingBackend
    ? (backendCollections ?? [])
    : demoCollections
  const tags = usingBackend
    ? (backendTags ?? []).map((t) => t.name)
    : data.tags

  // ── Load effect ─────────────────────────────────────────────

  const refreshAll = useCallback(async () => {
    if (!api.ready) {
      setBackendPapers(null)
      setBackendTags(null)
      setBackendCollections(null)
      setStats(null)
      return
    }
    setLoading(true)
    setErrorMsg(null)
    try {
      const [papersRes, tagsRes, collRes, statsRes] = await Promise.all([
        api.listPapers({ page: 1, limit: 200 }),
        api.listTags(),
        api.listCollections(),
        api.stats().catch(() => null),
      ])
      setBackendPapers(papersRes.papers.map(backendRowToCard))
      setBackendTags(tagsRes)
      setBackendCollections(
        collRes.map((c: LibraryCollectionRow) => ({
          id: c.name, // collections are keyed by name in the REST API
          name: c.name,
          description: c.description,
          paperCount: c.count,
        })),
      )
      setStats(statsRes)
    } catch (err) {
      // `localProLibrary` always resolves (backed by JSON file on disk),
      // so any error here means the IPC itself failed — rare, usually
      // pure-Vite dev mode. Fall back to the bundled demo data.
      setBackendPapers(null)
      const message = err instanceof Error ? err.message : String(err)
      setErrorMsg(message)
      toast.error(`Library load failed: ${message}`)
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    if (!open) return
    void refreshAll()
  }, [open, refreshAll])

  // Reset filters when modal closes.
  useEffect(() => {
    if (open) return
    setQuery('')
    setActiveTags(new Set())
    setDoiInput('')
    setCollectionId(ALL_PAPERS_ID)
    setSelectedPaperId(null)
    setErrorMsg(null)
    setReaderPaper(null)
  }, [open])

  // Escape: exit in-window reader first, then close modal / window.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (readerPaper) {
        e.preventDefault()
        setReaderPaper(null)
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, readerPaper])

  // ── Filter ──────────────────────────────────────────────────

  const filteredPapers = useMemo(
    () => filterPapers(papers, collectionId, query, activeTags),
    [papers, collectionId, query, activeTags],
  )

  useEffect(() => {
    if (!open) return
    if (filteredPapers.length === 0) {
      setSelectedPaperId(null)
      return
    }
    if (!filteredPapers.some((p) => p.id === selectedPaperId)) {
      setSelectedPaperId(filteredPapers[0].id)
    }
  }, [open, filteredPapers, selectedPaperId])

  const selectedPaper = useMemo(
    () => papers.find((p) => p.id === selectedPaperId) ?? null,
    [papers, selectedPaperId],
  )

  const handleOpen = useCallback(
    (paper: PaperCard) => {
      const artifactPaperId =
        paper.backendId != null ? String(paper.backendId) : paper.id
      const metadata = {
        title: paper.title,
        authors: paper.authors,
        year: Number(paper.year) || 0,
        venue: paper.venue,
        doi: paper.doi,
      }
      if (presentation === 'standalone') {
        setReaderPaper(paper)
        return
      }
      onOpenPaper(
        artifactPaperId,
        { ...metadata, abstract: paper.abstract },
        paper.abstract,
      )
      onClose()
    },
    [presentation, onOpenPaper, onClose],
  )

  const askablePapers = useMemo<PaperOption[]>(
    () =>
      filteredPapers
        .filter(
          (p): p is PaperCard & { backendId: number } => p.backendId != null,
        )
        .map((p) => ({
          id: p.backendId,
          title: p.title,
          authors: p.authors,
          year: p.year,
          venue: p.venue,
        })),
    [filteredPapers],
  )

  const handleOpenPaperByBackendId = useCallback(
    (paperId: number) => {
      const paper = papers.find((p) => p.backendId === paperId)
      if (paper) handleOpen(paper)
    },
    [papers, handleOpen],
  )

  // ── Action helpers ──────────────────────────────────────────

  const run = useCallback(
    async <T,>(
      key: string,
      fn: () => Promise<T>,
      onSuccess: (r: T) => void,
    ) => {
      setBusyKey(key)
      try {
        const r = await fn()
        onSuccess(r)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        toast.error(`${key}: ${message}`)
      } finally {
        setBusyKey(null)
      }
    },
    [],
  )

  const handleImportDoi = () => {
    const doi = doiInput.trim()
    if (!doi) {
      toast.warn('Enter a DOI to import')
      return
    }
    if (!canEdit) {
      toast.warn('Connect the backend to import by DOI')
      return
    }
    void run(
      'doi-import',
      () => api.addPaperByDoi({ doi }),
      (res) => {
        if (res.success) {
          toast.success(`Imported ${res.paper.title?.slice(0, 60) ?? doi}`)
          setDoiInput('')
          void refreshAll()
        } else {
          toast.error(res.error)
        }
      },
    )
  }

  const handleToggleTag = (tag: string) => {
    setActiveTags((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }

  const handleDeletePaper = (paper: PaperCard) => {
    if (paper.backendId == null) {
      toast.warn('Demo papers cannot be deleted')
      return
    }
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete "${paper.title}"? This cannot be undone.`))
      return
    void run(
      `delete-${paper.backendId}`,
      () => api.deletePaper(paper.backendId as number),
      (r) => {
        if (r.success) {
          toast.success('Paper deleted')
          void refreshAll()
        } else {
          toast.error(r.error ?? 'Delete failed')
        }
      },
    )
  }

  const handleAddTagToPaper = (paper: PaperCard, tag: string) => {
    if (paper.backendId == null) return
    const trimmed = tag.trim()
    if (!trimmed) return
    void run(
      'add-tag',
      () => api.addTag(paper.backendId as number, trimmed),
      (r) => {
        if (r.success) {
          toast.success(`Tagged “${trimmed}”`)
          void refreshAll()
        } else {
          toast.error(r.error ?? 'Tag failed')
        }
      },
    )
  }

  const handleRemoveTagFromPaper = (paper: PaperCard, tag: string) => {
    if (paper.backendId == null) return
    void run(
      'remove-tag',
      () => api.removeTag(paper.backendId as number, tag),
      (r) => {
        if (r.success) {
          void refreshAll()
        } else {
          toast.error(r.error ?? 'Untag failed')
        }
      },
    )
  }

  const handleCreateCollection = async () => {
    const name = await asyncPrompt('New collection name:')
    if (!name || !name.trim()) return
    void run(
      'create-coll',
      () => api.createCollection({ name: name.trim() }),
      (r) => {
        if (r.success) {
          toast.success(`Created collection ${name}`)
          void refreshAll()
        } else {
          toast.error(r.error)
        }
      },
    )
  }

  const handleDeleteCollection = (name: string) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete collection "${name}"? Papers are kept.`))
      return
    void run(
      'delete-coll',
      () => api.deleteCollection(name),
      (r) => {
        if (r.success) {
          toast.success(`Deleted ${name}`)
          if (collectionId === name) setCollectionId(ALL_PAPERS_ID)
          void refreshAll()
        }
      },
    )
  }

  const handleAddPaperToCollection = (paper: PaperCard, name: string) => {
    if (paper.backendId == null) return
    const backendId = paper.backendId
    void run(
      'add-to-coll',
      () => api.addToCollection(name, backendId),
      (r) => {
        if (r.success) {
          toast.success(`Added to ${name}`)
          void refreshAll()
        } else {
          toast.error('Add to collection failed')
        }
      },
    )
  }

  const handleRemovePaperFromCollection = (paper: PaperCard, name: string) => {
    if (paper.backendId == null) return
    const backendId = paper.backendId
    void run(
      'remove-from-coll',
      () => api.removeFromCollection(name, backendId),
      (r) => {
        if (r.success) {
          toast.success(`Removed from ${name}`)
          void refreshAll()
        } else {
          toast.error('Remove from collection failed')
        }
      },
    )
  }

  const handleUploadBibtex = async (file: File) => {
    void run(
      'bibtex',
      () => api.importBibtex(file),
      (r) => {
        if (r.success) {
          toast.success(`Imported ${r.imported} entries from ${file.name}`)
          void refreshAll()
        } else {
          toast.error(r.error)
        }
      },
    )
  }

  const handleUploadRis = async (file: File) => {
    const collection =
      collectionId !== ALL_PAPERS_ID ? collectionId : undefined
    void run(
      'ris',
      () => api.importRis(file, collection),
      (r) => {
        if (r.success) {
          toast.success(`Imported ${r.imported} entries from ${file.name}`)
          void refreshAll()
        } else {
          toast.error(r.error)
        }
      },
    )
  }

  const handleExportBibtex = async () => {
    if (!canEdit) {
      toast.warn('Backend not ready')
      return
    }
    void run(
      'export-bib',
      () =>
        api.exportBibtex(
          collectionId !== ALL_PAPERS_ID ? { collection: collectionId } : {},
        ),
      (text) => {
        downloadTextFile('references.bib', text, 'application/x-bibtex')
        toast.success('Exported references.bib')
      },
    )
  }

  const handleUploadPdf = async () => {
    if (!canEdit) {
      toast.warn('Backend not ready')
      return
    }
    const picker = window.electronAPI?.openFile
    if (!picker) {
      toast.warn('PDF upload requires the Electron desktop shell')
      return
    }
    const sourcePath = await picker({
      properties: ['openFile'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (!sourcePath) return
    const collection =
      collectionId !== ALL_PAPERS_ID ? collectionId : undefined
    void run(
      'upload-pdf',
      () => api.uploadPdf({ sourcePath, collection }),
      (r) => {
        if (r.success) {
          toast.success(
            r.deduped ? 'Attached PDF to existing paper' : 'Imported PDF',
          )
          void refreshAll()
          if (r.id != null) {
            extractPaperToKnowledge(r.id).then((res) => {
              if (res.chainCount > 0) {
                toast.info(`Extracted ${res.chainCount} chains`)
              }
            }).catch(() => {})
          }
        } else {
          toast.error(r.error)
        }
      },
    )
  }

  const handleExtractKnowledge = async () => {
    if (!canEdit) {
      toast.warn('Backend not ready')
      return
    }
    setBusyKey('extract-knowledge')
    setExtractProgress(null)
    try {
      const result = await extractAllPapersToKnowledge((p) => {
        setExtractProgress({ done: p.done, total: p.total })
      })
      const total = result.results.reduce((s, r) => s + r.chainCount, 0)
      if (total > 0) {
        toast.success(`Extracted ${total} chains from ${result.done} papers`)
      } else if (result.total === 0) {
        toast.info('No papers with PDFs in library')
      } else {
        toast.info('No new chains extracted')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Extraction failed')
    } finally {
      setBusyKey(null)
      setExtractProgress(null)
    }
  }

  const handleScanDirectory = async () => {
    if (!canEdit) {
      toast.warn('Backend not ready')
      return
    }
    let directory: string | undefined
    if (window.electronAPI?.openDirectory) {
      const chosen = await window.electronAPI.openDirectory()
      if (!chosen) return
      directory = chosen
    } else {
      const manual = await asyncPrompt(
        'Directory to scan (leave blank for session cwd):',
      )
      if (manual == null) return
      directory = manual.trim() || undefined
    }
    void run(
      'scan',
      // Match the backend/CLI default. The toast below already expects an
      // `extracted` count, so without this the chain-extraction pipeline
      // never fires.
      () => api.scan({ directory, extract: true }),
      (r) => {
        if (r.success) {
          // Show both scanned + added so "0 added" with scanned > 0 is
          // visibly distinct from "walk found nothing". Without this the
          // user can't tell if it's a path problem (0 scanned) or an
          // import problem (0 added of N scanned).
          const scanned = r.scanned ?? r.added
          const extracted =
            r.extracted != null && r.extracted > 0
              ? ` · extracted ${r.extracted}`
              : ''
          if (scanned === 0) {
            toast.warn(
              `Scan found no PDFs under that directory${
                r.errors && r.errors.length > 0
                  ? ` (${r.errors.length} subdirs unreadable)`
                  : ''
              }`,
            )
          } else {
            toast.success(
              `Scan: ${scanned} PDF${scanned === 1 ? '' : 's'} found · ${r.added} added${extracted}`,
            )
          }
          void refreshAll()
        } else {
          toast.error(r.error)
        }
      },
    )
  }

  const handleRefreshMetadata = async () => {
    if (!canEdit) {
      toast.warn('Backend not ready')
      return
    }
    const bridge = window.electronAPI?.libraryRefreshMetadata
    if (!bridge) {
      toast.error('Metadata refresh is only available in the Electron app')
      return
    }
    void run(
      'refresh-metadata',
      () => bridge(),
      (r) => {
        if (!r.success) {
          toast.error(`Refresh failed: ${r.error}`)
          return
        }
        const errorCount = r.errors?.length ?? 0
        const errorTail = errorCount > 0 ? ` · ${errorCount} error${errorCount === 1 ? '' : 's'}` : ''
        if (r.scanned === 0) {
          toast.info('No rows need metadata refresh')
        } else if (r.refreshed === 0) {
          toast.warn(
            `Checked ${r.scanned} row${r.scanned === 1 ? '' : 's'} — none resolved (${r.skipped} skipped)${errorTail}`,
          )
        } else {
          toast.success(
            `Refreshed ${r.refreshed}/${r.scanned} row${r.scanned === 1 ? '' : 's'} · ${r.skipped} skipped${errorTail}`,
          )
        }
        void refreshAll()
      },
    )
  }

  const readerArtifact = useMemo((): Artifact | null => {
    if (!readerPaper) return null
    return paperCardToReaderArtifact(readerPaper)
  }, [readerPaper])

  const readerHeadline = useMemo(() => {
    if (!readerPaper) return null
    return paperReaderHeadline({
      title: readerPaper.title,
      doi: readerPaper.doi,
      year: Number(readerPaper.year) || 0,
      venue: readerPaper.venue,
    })
  }, [readerPaper])

  const closeImportMenu = useCallback(() => {
    const el = importDetailsRef.current
    if (el) el.open = false
  }, [])

  const sendReaderToMainWorkspace = useCallback(() => {
    if (!readerPaper) return
    const artifactPaperId =
      readerPaper.backendId != null ? String(readerPaper.backendId) : readerPaper.id
    const metadata = {
      title: readerPaper.title,
      authors: readerPaper.authors,
      year: Number(readerPaper.year) || 0,
      venue: readerPaper.venue,
      doi: readerPaper.doi,
    }
    window.electronAPI?.librarySendPaperToMain?.({
      paperId: artifactPaperId,
      metadata,
      abstract: readerPaper.abstract,
    })
    toast.success('Opened in workspace')
  }, [readerPaper])

  if (!open) return null

  const totalPapers = papers.length

  // ── Render ──────────────────────────────────────────────────

  const isStandalone = presentation === 'standalone'
  const showStandaloneReader =
    isStandalone && readerPaper != null && readerArtifact != null

  return (
    <>
    <div
      className={
        isStandalone
          ? 'library-modal-standalone-root'
          : 'library-modal-backdrop'
      }
      onClick={isStandalone ? undefined : onClose}
    >
      <div
        onClick={isStandalone ? undefined : (e) => e.stopPropagation()}
        className={
          isStandalone
            ? 'library-modal-panel library-modal-panel--standalone library-win'
            : 'library-modal-panel'
        }
      >
        {showStandaloneReader && readerArtifact ? (
          <>
            <div className="library-modal-standalone-reader-toolbar">
              <IconButton
                icon={<ArrowLeft size={16} strokeWidth={1.75} />}
                label="Back to library"
                size="md"
                onClick={() => setReaderPaper(null)}
              />
              <span
                className="library-modal-standalone-reader-title"
                title={readerHeadline?.detailTitle ?? readerPaper.title}
              >
                {readerHeadline?.headline ?? readerPaper.title}
              </span>
              <span className="library-modal-header-spacer" />
              {typeof window !== 'undefined' &&
              window.electronAPI?.librarySendPaperToMain ? (
                <IconButton
                  icon={<ExternalLink size={16} strokeWidth={1.75} />}
                  label="Open in main workspace"
                  size="md"
                  onClick={sendReaderToMainWorkspace}
                />
              ) : null}
              <IconButton
                icon={<X size={18} strokeWidth={1.75} />}
                label="Close window"
                size="md"
                onClick={onClose}
              />
            </div>
            <div className="library-modal-standalone-reader-body">
              <PaperArtifactCard
                artifact={readerArtifact}
                suppressTitleRow
              />
            </div>
          </>
        ) : (
          <>
            <div
              className={
                isStandalone
                  ? 'library-modal-header library-modal-header--standalone-compact'
                  : 'library-modal-header'
              }
            >
              <div className="library-modal-header-top">
                <BookOpen size={18} strokeWidth={1.75} className="library-modal-accent-icon" />
                <div className="library-modal-header-titles">
                  <strong className="library-modal-title">Library</strong>
                  {stats ? (
                    <span className="library-modal-stats-badge">
                      {stats.total_papers} papers · {stats.tag_count} tags ·{' '}
                      {stats.collection_count} collections
                    </span>
                  ) : null}
                </div>
                {loading ? (
                  <Loader2
                    size={14}
                    className="spin library-modal-muted-icon"
                    aria-hidden
                  />
                ) : null}
                <span className="library-modal-header-spacer" />
                {!canEdit ? (
                  <span
                    className="library-modal-offline-badge"
                    title="Backend not connected"
                  >
                    Demo
                  </span>
                ) : null}
                {isStandalone ? (
                  <div
                    className="library-win-toolbar"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <IconButton
                      icon={<Upload size={16} strokeWidth={1.75} />}
                      label={
                        !canEdit
                          ? 'Connect backend to upload a PDF'
                          : 'Upload a PDF file'
                      }
                      size="md"
                      disabled={!canEdit || busyKey === 'upload-pdf'}
                      onClick={handleUploadPdf}
                    />
                    <IconButton
                      icon={<FolderOpen size={16} strokeWidth={1.75} />}
                      label={
                        !canEdit
                          ? 'Connect backend to scan a folder'
                          : 'Scan folder for PDFs'
                      }
                      size="md"
                      disabled={!canEdit || busyKey === 'scan'}
                      onClick={handleScanDirectory}
                    />
                    <IconButton
                      icon={<RefreshCw size={16} strokeWidth={1.75} />}
                      label={
                        !canEdit
                          ? 'Connect backend to refresh metadata'
                          : 'Refresh Crossref metadata for Unknown / spaced-DOI rows'
                      }
                      size="md"
                      disabled={
                        !canEdit || busyKey === 'refresh-metadata'
                      }
                      onClick={handleRefreshMetadata}
                    />
                    <details
                      ref={importDetailsRef}
                      className={[
                        'library-win-import',
                        !canEdit ? 'is-disabled' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <summary
                        className="library-win-import-summary"
                        title={
                          !canEdit
                            ? 'Connect backend to import BibTeX or RIS'
                            : 'Import BibTeX or RIS'
                        }
                        onClick={(e) => {
                          if (!canEdit) e.preventDefault()
                        }}
                      >
                        <FileText size={16} strokeWidth={1.75} aria-hidden />
                        <ChevronDown
                          size={14}
                          strokeWidth={1.75}
                          className="library-win-import-chevron"
                          aria-hidden
                        />
                      </summary>
                      <div className="library-win-import-menu">
                        <button
                          type="button"
                          className="library-win-import-item"
                          disabled={!canEdit || busyKey === 'bibtex'}
                          onClick={() => {
                            closeImportMenu()
                            bibtexInputRef.current?.click()
                          }}
                        >
                          BibTeX (.bib)
                        </button>
                        <button
                          type="button"
                          className="library-win-import-item"
                          disabled={!canEdit || busyKey === 'ris'}
                          onClick={() => {
                            closeImportMenu()
                            risInputRef.current?.click()
                          }}
                        >
                          RIS (.ris)
                        </button>
                      </div>
                    </details>
                    <IconButton
                      icon={<MessageSquare size={16} strokeWidth={1.75} />}
                      label={
                        !canEdit
                          ? 'Connect backend for multi-paper Q&A'
                          : askablePapers.length < 2
                            ? 'Need at least two filtered papers with backend IDs'
                            : 'Ask across filtered papers'
                      }
                      size="md"
                      disabled={!canEdit || askablePapers.length < 2}
                      onClick={() => setMultiQaOpen(true)}
                    />
                    <IconButton
                      icon={<Download size={16} strokeWidth={1.75} />}
                      label={
                        !canEdit
                          ? 'Connect backend to export BibTeX'
                          : 'Export current filter as BibTeX'
                      }
                      size="md"
                      disabled={!canEdit || busyKey === 'export-bib'}
                      onClick={handleExportBibtex}
                    />
                    <IconButton
                      icon={<Sparkles size={16} strokeWidth={1.75} />}
                      label={
                        !canEdit
                          ? 'Connect backend to extract chains'
                          : busyKey === 'extract-knowledge'
                            ? extractProgress
                              ? `Extracting ${extractProgress.done}/${extractProgress.total}…`
                              : 'Extracting chains…'
                            : 'Extract chains from all papers with PDFs'
                      }
                      size="md"
                      disabled={!canEdit || busyKey === 'extract-knowledge'}
                      onClick={handleExtractKnowledge}
                    />
                    {busyKey === 'extract-knowledge' && extractProgress ? (
                      <span className="library-modal-stats-badge" aria-live="polite">
                        {extractProgress.done}/{extractProgress.total}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                <IconButton
                  icon={<X size={18} strokeWidth={1.75} />}
                  label="Close (Esc)"
                  size="md"
                  onClick={onClose}
                />
              </div>
              {!isStandalone ? (
                <div className="library-modal-header-toolbar">
                  <button
                    type="button"
                    onClick={handleUploadPdf}
                    disabled={!canEdit || busyKey === 'upload-pdf'}
                    className="library-toolbar-btn"
                    title={
                      !canEdit
                        ? 'Connect backend to upload a PDF'
                        : 'Upload a single PDF'
                    }
                  >
                    <Upload size={14} strokeWidth={1.75} />
                    <span>PDF</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleScanDirectory}
                    disabled={!canEdit || busyKey === 'scan'}
                    className="library-toolbar-btn"
                    title={
                      !canEdit
                        ? 'Connect backend to scan a directory'
                        : 'Scan a directory for PDFs'
                    }
                  >
                    <FolderOpen size={14} strokeWidth={1.75} />
                    <span>Scan</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleRefreshMetadata}
                    disabled={!canEdit || busyKey === 'refresh-metadata'}
                    className="library-toolbar-btn"
                    title={
                      !canEdit
                        ? 'Connect backend to refresh metadata'
                        : 'Refresh Crossref metadata for Unknown / spaced-DOI rows'
                    }
                  >
                    <RefreshCw size={14} strokeWidth={1.75} />
                    <span>Refresh</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => bibtexInputRef.current?.click()}
                    disabled={!canEdit || busyKey === 'bibtex'}
                    className="library-toolbar-btn"
                    title={
                      !canEdit ? 'Connect backend to import BibTeX' : 'Import .bib file'
                    }
                  >
                    <Upload size={14} strokeWidth={1.75} />
                    <span>BibTeX</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => risInputRef.current?.click()}
                    disabled={!canEdit || busyKey === 'ris'}
                    className="library-toolbar-btn"
                    title={
                      !canEdit ? 'Connect backend to import RIS' : 'Import .ris file'
                    }
                  >
                    <Upload size={14} strokeWidth={1.75} />
                    <span>RIS</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMultiQaOpen(true)}
                    disabled={!canEdit || askablePapers.length < 2}
                    className="library-toolbar-btn"
                    title={
                      !canEdit
                        ? 'Connect backend to ask across papers'
                        : askablePapers.length < 2
                          ? 'Need at least two filtered papers with backend IDs'
                          : 'Ask across the current filtered papers'
                    }
                  >
                    <MessageSquare size={14} strokeWidth={1.75} />
                    <span>Ask</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleExportBibtex}
                    disabled={!canEdit || busyKey === 'export-bib'}
                    className="library-toolbar-btn"
                    title={
                      !canEdit
                        ? 'Connect backend to export BibTeX'
                        : 'Export current filter as BibTeX'
                    }
                  >
                    <Download size={14} strokeWidth={1.75} />
                    <span>Export</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleExtractKnowledge}
                    disabled={!canEdit || busyKey === 'extract-knowledge'}
                    className="library-toolbar-btn"
                    title={
                      !canEdit
                        ? 'Connect backend to extract chains'
                        : 'Extract chains from all papers with PDFs'
                    }
                  >
                    <Sparkles size={14} strokeWidth={1.75} />
                    <span>
                      {busyKey === 'extract-knowledge'
                        ? extractProgress
                          ? `Extracting ${extractProgress.done}/${extractProgress.total}…`
                          : 'Extracting…'
                        : 'Chains'}
                    </span>
                  </button>
                </div>
              ) : null}
            </div>
            <input
              ref={bibtexInputRef}
              type="file"
              accept=".bib,.bibtex"
              className="library-modal-hidden-input"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void handleUploadBibtex(f)
                e.target.value = ''
              }}
            />
            <input
              ref={risInputRef}
              type="file"
              accept=".ris"
              className="library-modal-hidden-input"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void handleUploadRis(f)
                e.target.value = ''
              }}
            />
            {errorMsg && (
              <div className="library-modal-error-banner">
                Library error: {errorMsg}
              </div>
            )}
            <div className="library-modal-body">
              <div
                className="library-modal-left-pane-wrap"
                style={{ width: leftWidth, flexShrink: 0 }}
              >
                <CollectionsPane
                  collections={collections}
                  totalPapers={totalPapers}
                  selectedId={collectionId}
                  onSelect={setCollectionId}
                  onCreate={canEdit ? handleCreateCollection : undefined}
                  onDelete={canEdit ? handleDeleteCollection : undefined}
                />
              </div>
              <Resizer
                orientation="vertical"
                value={leftWidth}
                min={160}
                max={400}
                onDraft={setLeftWidth}
                onCommit={(v) => {
                  setLeftWidth(v)
                  try { localStorage.setItem('lattice.library.leftWidth', String(v)) } catch { /* ignore */ }
                }}
                resetTo={220}
                label="Resize collections pane"
              />
              <MiddlePane
                papers={filteredPapers}
                query={query}
                onQueryChange={setQuery}
                tags={tags}
                activeTags={activeTags}
                onToggleTag={handleToggleTag}
                doiValue={doiInput}
                onDoiChange={setDoiInput}
                onDoiImport={handleImportDoi}
                doiBusy={busyKey === 'doi-import'}
                canEdit={canEdit}
                selectedPaperId={selectedPaperId}
                onSelectPaper={setSelectedPaperId}
                onOpenPaper={handleOpen}
                onDeletePaper={handleDeletePaper}
              />
              <Resizer
                orientation="vertical"
                value={rightWidth}
                min={240}
                max={520}
                invert
                onDraft={setRightWidth}
                onCommit={(v) => {
                  setRightWidth(v)
                  try { localStorage.setItem('lattice.library.rightWidth', String(v)) } catch { /* ignore */ }
                }}
                resetTo={320}
                label="Resize details pane"
              />
              <div
                className="library-modal-right-pane-wrap"
                style={{ width: rightWidth, flexShrink: 0 }}
              >
              <DetailsPane
                paper={selectedPaper}
                canEdit={canEdit}
                collections={collections}
                onAddTag={(tag) =>
                  selectedPaper && handleAddTagToPaper(selectedPaper, tag)
                }
                onRemoveTag={(tag) =>
                  selectedPaper && handleRemoveTagFromPaper(selectedPaper, tag)
                }
                onAddToCollection={(name) =>
                  selectedPaper && handleAddPaperToCollection(selectedPaper, name)
                }
                onRemoveFromCollection={(name) =>
                  selectedPaper &&
                  handleRemovePaperFromCollection(selectedPaper, name)
                }
              />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
    <MultiPaperQAModal
      open={multiQaOpen}
      papers={askablePapers}
      onClose={() => setMultiQaOpen(false)}
      onOpenPaper={handleOpenPaperByBackendId}
    />
    </>
  )
}

// ─── Data adapters ───────────────────────────────────────────────

function backendRowToCard(row: LibraryPaperRow): PaperCard {
  return {
    id: String(row.id),
    backendId: row.id,
    title: row.title || '(untitled)',
    authors: splitAuthors(row.authors),
    year: row.year ?? '',
    venue: row.journal ?? '',
    doi: row.doi,
    abstract: row.abstract ?? '',
    tags: row.tags ?? [],
    collections: row.collections ?? [],
    chainCount: row.chain_count ?? 0,
    pdfPath: row.pdf_path ?? null,
    pdfUrl: null,
  }
}

function demoPaperToCard(p: DemoPaper): PaperCard {
  return {
    id: p.id,
    backendId: null,
    title: p.title,
    authors: p.authors,
    year: String(p.year),
    venue: p.venue,
    doi: p.doi,
    abstract: p.abstract,
    tags: p.tags,
    collections: p.collectionId ? [p.collectionId] : [],
    chainCount: 0,
    pdfUrl: p.pdfUrl ?? null,
  }
}

function splitAuthors(raw: string): string[] {
  if (!raw) return []
  // Backend stores authors as ";"-separated. Some legacy rows use ", " —
  // handle both without splitting on commas inside names like "Li, A.".
  const primary = raw
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
  if (primary.length > 0) return primary
  return raw
    .split(' and ')
    .map((s) => s.trim())
    .filter(Boolean)
}

function filterPapers(
  papers: PaperCard[],
  collectionId: string,
  query: string,
  activeTags: Set<string>,
): PaperCard[] {
  const q = query.trim().toLowerCase()
  return papers.filter((p) => {
    if (collectionId !== ALL_PAPERS_ID) {
      // For demo data the collection id == collectionId; for backend data
      // the collection set carries names — match either.
      if (!p.collections.includes(collectionId)) return false
    }
    if (activeTags.size > 0 && !p.tags.some((t) => activeTags.has(t)))
      return false
    if (!q) return true
    return `${p.title}\n${p.authors.join(' ')}\n${p.abstract}`
      .toLowerCase()
      .includes(q)
  })
}

// Pane sub-components live in ./modal/ — this file is the orchestrator.

// Note: the narrower DemoCollection reference is kept to satisfy TypeScript's
// dead-code check — we only dereference it via the adapter above.
const _unusedDemoCollectionType = null as unknown as DemoCollection
void _unusedDemoCollectionType

