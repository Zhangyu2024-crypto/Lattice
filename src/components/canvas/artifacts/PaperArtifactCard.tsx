// PaperArtifactCard — full PDF reader with 4-tab side panel.
//
// Layout: [ PDF viewer | draggable split | Side panel ] — ratio persisted in
// localStorage. Side tabs: Annotations | AI Ask | Knowledge | Info
// Text selection: floating menu -> highlight / note / ask / extract
//
// Mirrors lattice-cli's `app.js` PDF reader (lines 3278-4466).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Copy,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Tag,
} from 'lucide-react'
import type { Artifact } from '../../../types/artifact'
import type {
  ChainNode,
  PaperAnnotation,
  PaperExtractionSummary,
  KnowledgeChain,
  PaperReadResponse,
  PaperReadSection,
  UpdateAnnotationRequest,
} from '../../../types/library-api'
import type { SaveChainsRequest } from '../../../types/knowledge-api'
import type { PaperArtifactPayload } from '../../../stores/demo-library'
import { useRuntimeStore } from '../../../stores/runtime-store'
import { localProLibrary } from '../../../lib/local-pro-library'
import { localProKnowledge } from '../../../lib/local-pro-knowledge'
import {
  formatPaperArtifactTitle,
  isUnknownPaperAuthor,
  paperReaderHeadline,
  splitPaperAuthors,
} from '../../../lib/paper-metadata'
import { toast } from '../../../stores/toast-store'
import { copyText } from '../../../lib/clipboard-helper'
import { dispatchMentionAdd } from '../../../lib/composer-bus'
import { usePdfQuoteStore } from '../../../stores/pdf-quote-store'
import type { MentionRef } from '../../../types/mention'
import PdfContinuousViewer from '../../library/PdfContinuousViewer'
import type { SelectionInfo } from '../../library/PdfContinuousViewer'
import PdfSelectionToolbar from '../../library/PdfSelectionToolbar'
import type { SelectionAction } from '../../library/PdfSelectionToolbar'
import ChainExtractModal from '../../library/ChainExtractModal'
import {
  Badge,
  Button,
} from '../../ui'
import AnnotationsTab, { type SideTab } from './paper/tabs/AnnotationsTab'
import type { AiMessage } from './paper/tabs/AiAskTab'
import AiAskTab from './paper/tabs/AiAskTab'
import KnowledgeTab, {
  type WholeExtractProgress,
} from './paper/tabs/KnowledgeTab'
import InfoTab from './paper/tabs/InfoTab'

interface Props {
  artifact: Artifact
  suppressTitleRow?: boolean
  onPatchMetadata?: (patch: { title?: string; payload?: unknown }) => void
}

interface LibraryPaperSnapshot {
  title?: string
  authors?: string
  year?: string
  journal?: string
  doi?: string
  abstract?: string
}

const PAPER_SPLIT_STORAGE_KEY = 'lattice.paperReader.splitRatio'
const PAPER_SPLIT_SPLITTER_PX = 9
const PAPER_SPLIT_MIN_LEFT = 220
const PAPER_SPLIT_MIN_RIGHT = 320
const PAPER_SPLIT_DEFAULT_RATIO = 0.58
const PAPER_STACKED_MQ = '(max-width: 1360px)'

function readInitialPaperSplitRatio(): number {
  try {
    const s = localStorage.getItem(PAPER_SPLIT_STORAGE_KEY)
    if (s) {
      const n = Number.parseFloat(s)
      if (Number.isFinite(n) && n >= 0.28 && n <= 0.85) return n
    }
  } catch {
    /* ignore */
  }
  return PAPER_SPLIT_DEFAULT_RATIO
}

function clampPaperSplitLeftPx(mainWidth: number, leftPx: number): number {
  const inner = mainWidth - PAPER_SPLIT_SPLITTER_PX
  if (inner <= 0) return PAPER_SPLIT_MIN_LEFT
  const maxLeft = Math.max(
    PAPER_SPLIT_MIN_LEFT,
    inner - PAPER_SPLIT_MIN_RIGHT,
  )
  return Math.max(PAPER_SPLIT_MIN_LEFT, Math.min(maxLeft, leftPx))
}

function venueInHeadline(
  headline: string,
  venue: string,
  year: number,
): boolean {
  const v = venue.trim()
  if (!v) return false
  const y = year > 0 ? String(year) : null
  return headline === v || Boolean(y && headline === `${v} (${y})`)
}

export default function PaperArtifactCard({
  artifact,
  suppressTitleRow = false,
}: Props) {
  const payload = artifact.payload as unknown as PaperArtifactPayload
  const { metadata } = payload
  // Self-contained Port §P3 v3 — library + knowledge facades are always
  // "ready" whenever the Electron shell is running. Annotations persist
  // locally; RAG / PDF / chain / extraction features throw with a
  // descriptive message until the P4 Python worker lands.
  const libApi = localProLibrary
  const kbApi = localProKnowledge
  const activeSessionId = useRuntimeStore((s) => s.activeSessionId)
  const patchArtifact = useRuntimeStore((s) => s.patchArtifact)

  const [tab, setTab] = useState<SideTab>('annotations')
  const [resolvedMetadata, setResolvedMetadata] = useState(metadata)

  // Annotations from backend
  const [annotations, setAnnotations] = useState<PaperAnnotation[]>([])
  const [annotationsLoading, setAnnotationsLoading] = useState(false)

  // Knowledge chains for this paper
  const [chains, setChains] = useState<KnowledgeChain[]>([])
  const [chainsLoading, setChainsLoading] = useState(false)

  // AI auto-extracted knowledge (cached on artifact payload)
  type AutoKnowledge = {
    triples: Array<{ material: string; property: string; value: string; method?: string; confidence?: string }>
    findings: Array<{ text: string; page?: number }>
  }
  const [autoKnowledge, setAutoKnowledge] = useState<AutoKnowledge | null>(
    ((payload as unknown as Record<string, unknown>).extractedKnowledge as AutoKnowledge) ?? null,
  )
  const [autoKnowledgeLoading, setAutoKnowledgeLoading] = useState(false)
  const autoKnowledgeTriggered = useRef(false)

  // AI Ask chat
  const [aiMessages, setAiMessages] = useState<AiMessage[]>([])
  const [aiInput, setAiInput] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const aiEndRef = useRef<HTMLDivElement>(null)

  // Text selection + floating menu
  const [selection, setSelection] = useState<SelectionInfo | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(
    null,
  )

  const mainSplitRef = useRef<HTMLDivElement>(null)
  const [splitRatio, setSplitRatio] = useState(readInitialPaperSplitRatio)
  const [splitDragging, setSplitDragging] = useState(false)
  const splitDragRef = useRef<{
    pointerId: number
    startX: number
    startLeftPx: number
  } | null>(null)
  const [layoutStacked, setLayoutStacked] = useState(false)

  // Info tab lazy data: full text + extractions are fetched on demand and
  // cached. Full text can be large, so keep it behind a user toggle.
  const [fullText, setFullText] = useState<string | null>(null)
  const [fullTextLoading, setFullTextLoading] = useState(false)
  const [fullTextError, setFullTextError] = useState<string | null>(null)
  const [showFullText, setShowFullText] = useState(false)
  const [extractions, setExtractions] = useState<PaperExtractionSummary[] | null>(null)
  const [extractionsLoading, setExtractionsLoading] = useState(false)

  // Inline annotation editor
  const [editingAnnId, setEditingAnnId] = useState<number | null>(null)
  const [editDraftContent, setEditDraftContent] = useState('')
  const [editDraftColor, setEditDraftColor] = useState('#D4D4D4')
  const [editSaving, setEditSaving] = useState(false)

  // Chain extraction modal
  const [extractModalOpen, setExtractModalOpen] = useState(false)
  const [extractedChains, setExtractedChains] = useState<KnowledgeChain[]>([])
  const [extracting, setExtracting] = useState(false)
  // Snapshot of the selection at extract time. The selection state is cleared
  // synchronously inside handleSelectionAction, so the modal can't read it
  // back live — without this, saveChains writes empty context to the DB.
  const [extractContext, setExtractContext] = useState<{
    text: string
    page: number
  } | null>(null)

  // Whole-paper extraction: orchestrates readPaper -> N x extractSelection -> saveChains.
  const [wholeExtracting, setWholeExtracting] = useState(false)
  const [wholeExtractProgress, setWholeExtractProgress] =
    useState<WholeExtractProgress | null>(null)
  // Monotonic request id to discard stale async results on paperId change or unmount.
  const wholeExtractReqId = useRef(0)

  // Derive the paperId (backend integer ID) from the artifact. Demo papers use
  // string ids like "pap-001" which must NOT be coerced — parseInt would yield
  // NaN, but a permissive regex like /^\d/ would match "123abc". Require pure
  // digits so demo ids fall through to the demo payload path.
  const paperId = useMemo(() => {
    const raw = (payload as unknown as { paperId?: string | number })?.paperId
    if (typeof raw === 'number') return Number.isSafeInteger(raw) ? raw : null
    if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (!/^\d+$/.test(trimmed)) return null
      const n = Number(trimmed)
      return Number.isSafeInteger(n) ? n : null
    }
    return null
  }, [payload])

  // PDF source resolution:
  //   - real papers (`paperId` is a library integer id): prefer raw PDF
  //     bytes so pdf.js can render a selectable text layer without any
  //     worker-side fetch. If byte transport fails, fall back to the
  //     direct main-process URL.
  //   - demo / inline cards: `payload.pdfUrl` is an http(s) URL baked
  //     into the session; keep that path unchanged.
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)

  useEffect(() => {
    setResolvedMetadata(metadata)
  }, [metadata])

  const persistSplitRatio = useCallback((ratio: number) => {
    try {
      localStorage.setItem(PAPER_SPLIT_STORAGE_KEY, String(ratio))
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    const mq = window.matchMedia(PAPER_STACKED_MQ)
    const sync = () => setLayoutStacked(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (layoutStacked) return
    const main = mainSplitRef.current
    if (!main) return
    const ro = new ResizeObserver(() => {
      const rect = main.getBoundingClientRect()
      const inner = rect.width - PAPER_SPLIT_SPLITTER_PX
      if (inner <= 0) return
      setSplitRatio((r) => {
        const clampedPx = clampPaperSplitLeftPx(rect.width, r * inner)
        const next = clampedPx / inner
        return next === r ? r : next
      })
    })
    ro.observe(main)
    return () => ro.disconnect()
  }, [layoutStacked])

  useEffect(() => {
    if (!splitDragging) return
    const prev = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    return () => {
      document.body.style.userSelect = prev
    }
  }, [splitDragging])

  const onSplitPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (layoutStacked || e.button !== 0) return
      const main = mainSplitRef.current
      if (!main) return
      e.preventDefault()
      e.stopPropagation()
      const rect = main.getBoundingClientRect()
      const inner = rect.width - PAPER_SPLIT_SPLITTER_PX
      if (inner <= 0) return
      const startLeftPx = clampPaperSplitLeftPx(
        rect.width,
        splitRatio * inner,
      )
      splitDragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startLeftPx,
      }
      e.currentTarget.setPointerCapture(e.pointerId)
      setSplitDragging(true)
    },
    [layoutStacked, splitRatio],
  )

  const onSplitPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = splitDragRef.current
      if (!d || e.pointerId !== d.pointerId) return
      const main = mainSplitRef.current
      if (!main) return
      const rect = main.getBoundingClientRect()
      const inner = rect.width - PAPER_SPLIT_SPLITTER_PX
      if (inner <= 0) return
      const dx = e.clientX - d.startX
      const nextLeft = clampPaperSplitLeftPx(rect.width, d.startLeftPx + dx)
      setSplitRatio(nextLeft / inner)
    },
    [],
  )

  const endSplitDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = splitDragRef.current
      if (!d || e.pointerId !== d.pointerId) return
      const main = mainSplitRef.current
      const rect = main?.getBoundingClientRect()
      splitDragRef.current = null
      setSplitDragging(false)
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* already released */
      }
      if (!main || !rect) return
      const inner = rect.width - PAPER_SPLIT_SPLITTER_PX
      if (inner <= 0) return
      const dx = e.clientX - d.startX
      const finalLeft = clampPaperSplitLeftPx(rect.width, d.startLeftPx + dx)
      const ratio = finalLeft / inner
      setSplitRatio(ratio)
      persistSplitRatio(ratio)
    },
    [persistSplitRatio],
  )

  const onSplitLostCapture = useCallback(() => {
    splitDragRef.current = null
    setSplitDragging(false)
  }, [])

  const onSplitDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      if (layoutStacked) return
      setSplitRatio(PAPER_SPLIT_DEFAULT_RATIO)
      persistSplitRatio(PAPER_SPLIT_DEFAULT_RATIO)
    },
    [layoutStacked, persistSplitRatio],
  )

  useEffect(() => {
    if (paperId == null || !libApi.ready) return
    const getter = window.electronAPI?.libraryGetPaper
    if (!getter) return

    let cancelled = false
    void getter(paperId)
      .then((lookup) => {
        if (cancelled || lookup.error || !lookup.paper) return
        const nextMetadata = mergePaperMetadata(metadata, lookup.paper)
        setResolvedMetadata((current) =>
          paperMetadataEquals(current, nextMetadata) ? current : nextMetadata,
        )

        if (!activeSessionId) return
        const nextTitle = formatPaperArtifactTitle(
          nextMetadata.title,
          nextMetadata.authors,
          nextMetadata.doi,
        )
        const needsPayloadPatch = !paperMetadataEquals(metadata, nextMetadata)
        if (!needsPayloadPatch && artifact.title === nextTitle) return

        patchArtifact(activeSessionId, artifact.id, {
          title: nextTitle,
          payload: {
            ...payload,
            metadata: nextMetadata,
          } as never,
        })
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [
    activeSessionId,
    artifact.id,
    artifact.title,
    libApi.ready,
    metadata,
    paperId,
    patchArtifact,
    payload,
  ])

  useEffect(() => {
    let cancelled = false

    if (paperId != null && libApi.ready) {
      setPdfUrl(null)
      void libApi.pdfBytes(paperId).then(async (buf) => {
        if (cancelled) return
        if (buf) {
          setPdfData(new Uint8Array(buf))
          setPdfUrl(null)
          return
        }
        const resolvedUrl = await libApi.pdfUrl(paperId)
        if (cancelled) return
        setPdfData(null)
        setPdfUrl(resolvedUrl)
      })
    } else {
      setPdfData(null)
      setPdfUrl(payload.pdfUrl ?? null)
    }

    return () => {
      cancelled = true
    }
  }, [paperId, libApi, payload.pdfUrl])

  // ── Load annotations + chains on mount ────────────────────────

  const loadAnnotations = useCallback(async () => {
    if (!libApi.ready || paperId == null) return
    setAnnotationsLoading(true)
    try {
      const list = await libApi.listAnnotations(paperId)
      setAnnotations(Array.isArray(list) ? list : [])
    } catch {
      // Backend may not have annotations.
    } finally {
      setAnnotationsLoading(false)
    }
  }, [libApi, paperId])

  const loadChains = useCallback(async () => {
    if (paperId == null) return
    setChainsLoading(true)
    try {
      const saved = await kbApi.chainsByPaper(paperId)
      setChains(saved.map((m) => ({
        id: m.chain_id,
        extraction_id: m.extraction_id,
        domain_type: m.domain_type ?? 'materials',
        chain_type: m.chain_type ?? '',
        context_text: m.context_text ?? '',
        context_section: m.context_section ?? '',
        confidence: m.confidence,
        nodes: m.nodes,
      })))
    } catch {
      setChains([])
    } finally {
      setChainsLoading(false)
    }
  }, [kbApi, paperId])

  // Auto-extract knowledge on mount if no cached result exists.
  useEffect(() => {
    if (autoKnowledge || autoKnowledgeTriggered.current) return
    if (paperId == null) return
    autoKnowledgeTriggered.current = true
    setAutoKnowledgeLoading(true)
    void (async () => {
      try {
        const { runAutoExtract } = await import(
          '../../../lib/agent-tools/auto-extract-knowledge'
        )
        const result = await runAutoExtract(
          paperId,
          activeSessionId ?? '',
        )
        if (result.success) {
          const knowledge = {
            triples: result.triples,
            findings: result.findings,
          }
          setAutoKnowledge(knowledge)
          // Cache on artifact payload so re-opening skips the LLM call
          patchArtifact(activeSessionId ?? '', artifact.id, {
            payload: {
              ...payload,
              extractedKnowledge: { ...knowledge, extractedAt: Date.now() },
            },
          } as never)
        }
      } catch {
        // Non-fatal — user can still manually trigger via agent
      } finally {
        setAutoKnowledgeLoading(false)
      }
    })()
  }, [paperId, autoKnowledge, activeSessionId, artifact.id, payload, patchArtifact])

  const loadFullText = useCallback(async () => {
    if (!libApi.ready || paperId == null) return
    if (fullText != null || fullTextLoading) return
    setFullTextLoading(true)
    setFullTextError(null)
    try {
      const res = await libApi.readPaper(paperId)
      if (res.success) {
        setFullText(res.full_text)
      } else {
        setFullTextError(res.error || 'Failed to read paper')
        toast.error(`Read paper failed: ${res.error}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setFullTextError(msg)
      toast.error(`Read paper failed: ${msg}`)
    } finally {
      setFullTextLoading(false)
    }
  }, [libApi, paperId, fullText, fullTextLoading])

  const loadExtractions = useCallback(
    async (opts?: { force?: boolean }) => {
      if (!libApi.ready || paperId == null) return
      if (extractionsLoading) return
      if (!opts?.force && extractions != null) return
      setExtractionsLoading(true)
      try {
        const res = await libApi.paperExtractions(paperId)
        setExtractions(res.extractions ?? [])
      } catch (err) {
        toast.error(
          `Extractions failed: ${err instanceof Error ? err.message : String(err)}`,
        )
        setExtractions([])
      } finally {
        setExtractionsLoading(false)
      }
    },
    [libApi, paperId, extractions, extractionsLoading],
  )

  useEffect(() => {
    void loadAnnotations()
    void loadChains()
  }, [loadAnnotations, loadChains])

  useEffect(
    () => () => {
      wholeExtractReqId.current += 1
    },
    [],
  )

  useEffect(() => {
    wholeExtractReqId.current += 1
    setWholeExtracting(false)
    setWholeExtractProgress(null)
  }, [paperId])

  // Lazy-load extractions the first time the user opens the Info tab. Full
  // text stays gated behind an explicit "Show full text" toggle.
  useEffect(() => {
    if (tab === 'info') void loadExtractions()
  }, [tab, loadExtractions])

  useEffect(() => {
    aiEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [aiMessages.length])

  // ── Text selection handler ────────────────────────────────────

  const handleTextSelect = useCallback((info: SelectionInfo) => {
    setSelection(info)
    setMenuPos({
      top: info.menuTop ?? 60,
      left: info.menuLeft ?? 300,
    })
  }, [])

  const handleClearSelection = useCallback(() => {
    setSelection(null)
    setMenuPos(null)
  }, [])

  // ── Selection menu actions ────────────────────────────────────

  const handleSelectionAction = useCallback(
    async (action: SelectionAction) => {
      if (!selection) return
      const sel = selection
      setSelection(null)
      setMenuPos(null)

      switch (action.type) {
        case 'highlight': {
          if (paperId == null || !libApi.ready) {
            toast.warn('Backend needed for annotations')
            return
          }
          try {
            await libApi.addAnnotation(paperId, {
              page: sel.page,
              type: 'highlight',
              color: action.color,
              content: sel.text.slice(0, 500),
              rects: sel.rects,
            })
            toast.success('Highlight saved')
            void loadAnnotations()
          } catch (err) {
            toast.error(
              `Highlight failed: ${err instanceof Error ? err.message : String(err)}`,
            )
          }
          break
        }
        case 'note': {
          if (!action.content.trim() || paperId == null || !libApi.ready) return
          try {
            await libApi.addAnnotation(paperId, {
              page: sel.page,
              type: 'note',
              color: action.color,
              content: action.content.trim(),
              rects: sel.rects,
            })
            toast.success('Note saved')
            void loadAnnotations()
          } catch (err) {
            toast.error(
              `Note failed: ${err instanceof Error ? err.message : String(err)}`,
            )
          }
          break
        }
        case 'underline':
        case 'strike':
        case 'todo': {
          if (paperId == null || !libApi.ready) {
            toast.warn('Backend needed for annotations')
            return
          }
          try {
            await libApi.addAnnotation(paperId, {
              page: sel.page,
              type: action.type,
              color: '#D4D4D4',
              content: sel.text.slice(0, 500),
              rects: sel.rects,
            })
            toast.success(`${action.type} saved`)
            void loadAnnotations()
          } catch (err) {
            toast.error(`Annotation failed: ${err instanceof Error ? err.message : String(err)}`)
          }
          break
        }
        case 'copy': {
          void navigator.clipboard.writeText(sel.text)
          toast.info('Copied to clipboard')
          break
        }
        case 'ask': {
          const excerpt = sel.text.slice(0, 200)
          const hash = Math.abs(
            [...`${paperId ?? artifact.id}:${sel.page}:${excerpt}`].reduce(
              (h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0,
            ),
          ).toString(36).slice(0, 12)
          const ref: MentionRef = {
            type: 'pdf-quote',
            paperId: paperId ?? artifact.id,
            page: sel.page,
            quoteHash: hash,
            excerpt,
          }
          const title = artifact.title.length > 30
            ? `${artifact.title.slice(0, 27)}…`
            : artifact.title
          const chipLabel = `${title} · p.${sel.page}`
          dispatchMentionAdd({ ref, label: chipLabel })
          // Register in the global pdf-quote store so the @ picker shows
          // previously-highlighted passages under "PDF HIGHLIGHTS".
          usePdfQuoteStore.getState().addQuote({
            ref: ref as MentionRef & { type: 'pdf-quote' },
            label: chipLabel,
            excerpt,
            addedAt: Date.now(),
          })
          // Also persist as a visual highlight in the PDF so the user sees
          // which passages were sent to AI.
          if (paperId != null && libApi.ready) {
            void libApi.addAnnotation(paperId, {
              page: sel.page,
              type: 'highlight',
              color: '#818cf8',
              content: `AI: ${excerpt.slice(0, 60)}…`,
              rects: sel.rects,
              label: 'AI quote',
            }).then(() => void loadAnnotations()).catch(() => {})
          }
          break
        }
        case 'define': {
          if (!kbApi.ready) {
            toast.warn('Knowledge extraction not available')
            return
          }
          setTab('knowledge')
          setExtracting(true)
          try {
            const res = await kbApi.extractSelection({
              text: sel.text,
              paper_id: paperId ?? undefined,
              page: sel.page,
            })
            if (res.success) {
              setExtractContext({ text: sel.text, page: sel.page })
              setExtractedChains(res.chains)
              setExtractModalOpen(true)
              toast.success(`Extracted ${res.chains.length} chains`)
            } else {
              toast.error(res.error)
            }
          } catch (err) {
            toast.error(
              `Extraction failed: ${err instanceof Error ? err.message : String(err)}`,
            )
          } finally {
            setExtracting(false)
          }
          break
        }
      }
    },
    [selection, paperId, libApi, kbApi, loadAnnotations],
  )

  // ── Whole-paper extraction ────────────────────────────────────

  const handleExtractWhole = useCallback(async () => {
    if (paperId == null || !libApi.ready || !kbApi.ready) {
      toast.warn('Backend needed for whole-paper extraction')
      return
    }
    if (wholeExtracting) return

    const runId = ++wholeExtractReqId.current
    const isStale = () => runId !== wholeExtractReqId.current

    setTab('knowledge')
    setWholeExtracting(true)
    setWholeExtractProgress({
      phase: 'reading',
      total: 0,
      done: 0,
      succeeded: 0,
      failed: 0,
      chainCount: 0,
    })

    try {
      const raw = await libApi.readPaper(paperId)
      if (isStale()) return
      if (!raw.success) {
        toast.error(`Read paper failed: ${raw.error}`)
        return
      }

      const chunks = buildWholePaperChunks(raw)
      if (chunks.length === 0) {
        toast.warn('No extractable sections found')
        return
      }

      setWholeExtractProgress({
        phase: 'extracting',
        total: chunks.length,
        done: 0,
        succeeded: 0,
        failed: 0,
        chainCount: 0,
      })

      const extracted = await mapLimit(
        chunks,
        WHOLE_EXTRACT_CONCURRENCY,
        async (chunk) => {
          const res = await kbApi.extractSelection({
            text: chunk.text,
            paper_id: paperId,
            page: 1,
          })
          if (!res.success) throw new Error(res.error)
          return res.chains.map((chain) => chainToSaveDraft(chain, chunk.label))
        },
        (ok, drafts) => {
          if (isStale()) return
          const added = ok && drafts ? drafts.length : 0
          setWholeExtractProgress((prev) =>
            prev
              ? {
                  ...prev,
                  done: prev.done + 1,
                  succeeded: prev.succeeded + (ok ? 1 : 0),
                  failed: prev.failed + (ok ? 0 : 1),
                  chainCount: prev.chainCount + added,
                }
              : prev,
          )
        },
      )
      if (isStale()) return

      const drafts = dedupeSaveDrafts(extracted.flat(), chains)
      if (drafts.length === 0) {
        toast.warn('No new chains found')
        return
      }

      setWholeExtractProgress((prev) =>
        prev ? { ...prev, phase: 'saving' } : prev,
      )
      const saved = await kbApi.saveChains({ paper_id: paperId, chains: drafts })
      if (isStale()) return
      if (!saved.success) {
        toast.error(`Save failed: ${saved.error}`)
        return
      }

      await loadChains()
      if (isStale()) return
      void loadExtractions({ force: true })
      toast.success(`Saved ${saved.count} chains`)
    } catch (err) {
      if (isStale()) return
      toast.error(
        `Whole-paper extraction failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      if (!isStale()) {
        setWholeExtracting(false)
        setWholeExtractProgress(null)
      }
    }
  }, [
    paperId,
    libApi,
    kbApi,
    wholeExtracting,
    chains,
    loadChains,
    loadExtractions,
  ])

  // ── AI Ask (full-text paper QA) ──────────────────────────────
  //
  // Bypass the Python worker's TF-IDF retrieval. Extract the full PDF
  // text via pdfjs, stuff it into the LLM context window, and let the
  // model answer with full-document awareness. Cached across questions.

  const fullTextRef = useRef<{ text: string; pageCount: number } | null>(null)
  const [extractingText, setExtractingText] = useState(false)

  const handleAiAsk = useCallback(async () => {
    const q = aiInput.trim()
    if (!q || aiLoading) return
    setAiInput('')
    const userMsg: AiMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      content: q,
    }
    setAiMessages((prev) => [...prev, userMsg])
    setAiLoading(true)

    try {
      if (!fullTextRef.current) {
        if (!pdfData && !pdfUrl) {
          throw new Error('No PDF loaded — open a paper with an attached PDF first')
        }
        setExtractingText(true)
        const { extractFullText } = await import('../../../lib/pdf-text-extract')
        fullTextRef.current = await extractFullText(
          pdfData ? { data: pdfData } : { url: pdfUrl! },
        )
        setExtractingText(false)
      }

      const paperTitle =
        resolvedMetadata?.title ||
        (artifact.payload as { title?: string } | undefined)?.title ||
        'Paper'

      const prompt = [
        'You are a research assistant. The user has opened a scientific paper and is asking questions about it.',
        'Answer based on the paper content below. Cite specific pages when possible (e.g. "on page 3...").',
        'If the paper does not contain enough information to answer, say so clearly.',
        '',
        `Paper title: ${paperTitle}`,
        `Full text (${fullTextRef.current.pageCount} pages):`,
        '',
        fullTextRef.current.text,
        '',
        `User question: ${q}`,
      ].join('\n')

      const { sendLlmChat } = await import('../../../lib/llm-chat')
      const reply = await sendLlmChat({
        mode: 'dialog',
        userMessage: prompt,
        transcript: aiMessages
          .slice(-6)
          .map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: Date.now(),
          })),
        sessionId: null,
      })

      if (reply.success) {
        setAiMessages((prev) => [
          ...prev,
          { id: `a_${Date.now()}`, role: 'assistant', content: reply.content },
        ])
      } else {
        setAiMessages((prev) => [
          ...prev,
          {
            id: `a_${Date.now()}`,
            role: 'assistant',
            content: `Error: ${reply.error ?? 'LLM call failed. Check Settings → Models for a configured provider + API key.'}`,
          },
        ])
      }
    } catch (err) {
      setExtractingText(false)
      setAiMessages((prev) => [
        ...prev,
        {
          id: `a_${Date.now()}`,
          role: 'assistant',
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ])
    } finally {
      setAiLoading(false)
    }
  }, [aiInput, aiLoading, pdfData, pdfUrl, resolvedMetadata, artifact.payload, aiMessages])

  // ── Delete annotation ─────────────────────────────────────────

  const handleDeleteAnnotation = useCallback(
    async (annId: number) => {
      try {
        await libApi.deleteAnnotation(annId)
        void loadAnnotations()
      } catch {
        toast.error('Delete failed')
      }
    },
    [libApi, loadAnnotations],
  )

  // ── Edit annotation ───────────────────────────────────────────

  const handleEditStart = useCallback((ann: PaperAnnotation) => {
    setEditingAnnId(ann.id)
    setEditDraftContent(ann.content ?? '')
    setEditDraftColor(ann.color || '#D4D4D4')
  }, [])

  const handleEditCancel = useCallback(() => {
    setEditingAnnId(null)
    setEditDraftContent('')
  }, [])

  const handleEditSave = useCallback(
    async (ann: PaperAnnotation) => {
      if (!libApi.ready) {
        toast.warn('Backend needed for annotations')
        return
      }
      // UpdateAnnotationRequest has no `type` field — annotations can only
      // mutate content/color/page/rects. Send only fields that changed.
      const req: UpdateAnnotationRequest = {}
      if (ann.type === 'highlight') {
        if (editDraftColor && editDraftColor !== ann.color) {
          req.color = editDraftColor
        }
      } else {
        const next = editDraftContent.trim()
        if (next !== (ann.content ?? '').trim()) {
          req.content = next
        }
      }
      if (Object.keys(req).length === 0) {
        handleEditCancel()
        return
      }
      setEditSaving(true)
      try {
        await libApi.updateAnnotation(ann.id, req)
        toast.success('Annotation updated')
        handleEditCancel()
        void loadAnnotations()
      } catch (err) {
        toast.error(
          `Update failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      } finally {
        setEditSaving(false)
      }
    },
    [libApi, editDraftContent, editDraftColor, handleEditCancel, loadAnnotations],
  )

  // ── Copy DOI ──────────────────────────────────────────────────

  const copyDoi = async () => {
    if (!resolvedMetadata.doi) {
      toast.warn('No DOI')
      return
    }
    void copyText(resolvedMetadata.doi, `DOI copied: ${resolvedMetadata.doi}`)
  }

  const readerHeadline = useMemo(
    () =>
      paperReaderHeadline({
        title: resolvedMetadata.title,
        doi: resolvedMetadata.doi,
        year: resolvedMetadata.year,
        venue: resolvedMetadata.venue,
      }),
    [resolvedMetadata],
  )

  const topByline = useMemo(() => {
    const parts: string[] = []
    const authors = resolvedMetadata.authors.filter(
      (a) => !isUnknownPaperAuthor(a),
    )
    if (authors.length > 0) {
      parts.push(authors.join(', '))
    }
    const y = resolvedMetadata.year > 0 ? String(resolvedMetadata.year) : null
    const v = resolvedMetadata.venue.trim()
    const hl = readerHeadline.headline
    const headlineShowsVenue =
      Boolean(v) && (hl === v || Boolean(y && hl === `${v} (${y})`))
    const headlineShowsYear =
      Boolean(y) && /^DOI\s+10\./i.test(hl) && hl.includes(` · ${y}`)
    if (!headlineShowsVenue && y && !headlineShowsYear) {
      parts.push(y)
    }
    if (!headlineShowsVenue && v) {
      parts.push(v)
    }
    return parts.join(' · ')
  }, [resolvedMetadata, readerHeadline.headline])

  const showVenueBadge =
    Boolean(resolvedMetadata.venue.trim()) &&
    !venueInHeadline(
      readerHeadline.headline,
      resolvedMetadata.venue,
      resolvedMetadata.year,
    )
  const showDoiBtn = Boolean(resolvedMetadata.doi?.trim())
  const topActionsVisible = showVenueBadge || showDoiBtn
  const showTopBar = !suppressTitleRow || topActionsVisible

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="card-paper-root">
      {showTopBar ? (
        <div
          className={
            'card-paper-top-bar' +
            (suppressTitleRow && topActionsVisible
              ? ' card-paper-top-bar--actions-only'
              : '')
          }
        >
          {!suppressTitleRow ? (
            <div className="card-paper-top-copy">
              <strong
                className="card-paper-top-title"
                title={readerHeadline.detailTitle}
              >
                {readerHeadline.headline}
              </strong>
              {topByline && (
                <div className="card-paper-top-byline" title={topByline}>
                  {topByline}
                </div>
              )}
            </div>
          ) : null}
          {topActionsVisible ? (
            <div className="card-paper-top-actions">
              {showVenueBadge ? (
                <Badge variant="neutral">{resolvedMetadata.venue}</Badge>
              ) : null}
              {showDoiBtn ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={copyDoi}
                  title="Copy DOI"
                  leading={<Copy size={11} />}
                  trailing={<ExternalLink size={11} />}
                  className="card-paper-doi-btn"
                >
                  <span className="card-paper-doi-text">
                    {resolvedMetadata.doi}
                  </span>
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        ref={mainSplitRef}
        className={
          'card-paper-main' + (splitDragging ? ' is-split-dragging' : '')
        }
      >
        {/* PDF Viewer */}
        <div
          className="card-paper-viewer-wrap"
          style={
            layoutStacked
              ? undefined
              : {
                  width: `calc((100% - ${PAPER_SPLIT_SPLITTER_PX}px) * ${splitRatio})`,
                  minWidth: PAPER_SPLIT_MIN_LEFT,
                  maxWidth: `calc(100% - ${PAPER_SPLIT_SPLITTER_PX + PAPER_SPLIT_MIN_RIGHT}px)`,
                }
          }
        >
          {pdfData || pdfUrl ? (
            <div className="card-paper-viewer-inner">
              <PdfContinuousViewer
                data={pdfData ?? undefined}
                url={pdfUrl ?? undefined}
                paperId={paperId ?? artifact.id}
                annotations={annotations}
                onTextSelect={handleTextSelect}
                onClearSelection={handleClearSelection}
              />
              <PdfSelectionToolbar
                anchorRect={selection?.anchorRect ?? null}
                onAction={handleSelectionAction}
                onDismiss={handleClearSelection}
              />
            </div>
          ) : (
            <AbstractFallback metadata={resolvedMetadata} />
          )}
        </div>

        {!layoutStacked ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-valuemin={28}
            aria-valuemax={85}
            aria-valuenow={Math.round(splitRatio * 100)}
            aria-label="Resize PDF and side panel"
            title="Drag to resize · Double-click to reset"
            tabIndex={0}
            className="card-paper-splitter"
            onPointerDown={onSplitPointerDown}
            onPointerMove={onSplitPointerMove}
            onPointerUp={endSplitDrag}
            onPointerCancel={endSplitDrag}
            onLostPointerCapture={onSplitLostCapture}
            onDoubleClick={onSplitDoubleClick}
          >
            <span className="card-paper-splitter-grip" aria-hidden />
          </div>
        ) : null}

        {/* Side Panel */}
        <div className="card-paper-side-panel">
          <div className="card-paper-tab-row">
            {tabBtn('annotations', 'Annotations', tab, setTab)}
            {tabBtn('ai', 'Chat', tab, setTab)}
            {tabBtn('knowledge', 'Knowledge', tab, setTab)}
          </div>
          <div className="card-paper-tab-body">
            {tab === 'annotations' && (
              <AnnotationsTab
                annotations={annotations}
                loading={annotationsLoading}
                onDelete={handleDeleteAnnotation}
                editingAnnId={editingAnnId}
                editDraftContent={editDraftContent}
                editDraftColor={editDraftColor}
                editSaving={editSaving}
                onEditStart={handleEditStart}
                onEditContentChange={setEditDraftContent}
                onEditColorChange={setEditDraftColor}
                onEditSave={handleEditSave}
                onEditCancel={handleEditCancel}
                canEdit={libApi.ready}
                onNavigateTab={setTab}
              />
            )}
            {tab === 'ai' && (
              <AiAskTab
                messages={aiMessages}
                input={aiInput}
                onInputChange={setAiInput}
                onSend={handleAiAsk}
                loading={aiLoading}
                endRef={aiEndRef}
                ready
              />
            )}
            {tab === 'knowledge' && (
              autoKnowledgeLoading ? (
                <div style={{ padding: 16, color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>
                  <Loader2 size={14} className="spin" style={{ marginRight: 6, verticalAlign: 'middle' }} />
                  Extracting knowledge from paper…
                </div>
              ) : autoKnowledge ? (
                <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto', fontSize: 'var(--text-xs)' }}>
                  {autoKnowledge.triples.length > 0 && (
                    <div>
                      <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--color-text-primary)' }}>
                        Structured Facts ({autoKnowledge.triples.length})
                      </div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-xs)' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                            <th style={{ textAlign: 'left', padding: '4px 6px' }}>Material</th>
                            <th style={{ textAlign: 'left', padding: '4px 6px' }}>Property</th>
                            <th style={{ textAlign: 'left', padding: '4px 6px' }}>Value</th>
                            <th style={{ textAlign: 'left', padding: '4px 6px' }}>Method</th>
                          </tr>
                        </thead>
                        <tbody>
                          {autoKnowledge.triples.map((t, i) => (
                            <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                              <td style={{ padding: '4px 6px', color: 'var(--color-text-primary)' }}>{t.material}</td>
                              <td style={{ padding: '4px 6px' }}>{t.property}</td>
                              <td style={{ padding: '4px 6px', fontFamily: 'var(--font-mono)' }}>{t.value}</td>
                              <td style={{ padding: '4px 6px', color: 'var(--color-text-muted)' }}>{t.method ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {autoKnowledge.findings.length > 0 && (
                    <div>
                      <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--color-text-primary)' }}>
                        Key Findings ({autoKnowledge.findings.length})
                      </div>
                      <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {autoKnowledge.findings.map((f, i) => (
                          <li key={i} style={{ color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                            {f.text}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <KnowledgeTab
                  chains={chains}
                  loading={chainsLoading || extracting}
                  onRefresh={loadChains}
                  onExtractWhole={handleExtractWhole}
                  canExtractWhole={
                    libApi.ready && kbApi.ready && paperId != null
                  }
                  wholeExtracting={wholeExtracting}
                  wholeExtractProgress={wholeExtractProgress}
                />
              )
            )}
            {tab === 'info' && (
              <InfoTab
                metadata={resolvedMetadata}
                paperId={paperId}
                annotationCount={annotations.length}
                chainCount={chains.length}
                backendAvailable={libApi.ready && paperId != null}
                extractions={extractions}
                extractionsLoading={extractionsLoading}
                fullText={fullText}
                fullTextLoading={fullTextLoading}
                fullTextError={fullTextError}
                showFullText={showFullText}
                onToggleFullText={() => {
                  const next = !showFullText
                  setShowFullText(next)
                  if (next) void loadFullText()
                }}
              />
            )}
          </div>
        </div>
      </div>

      <ChainExtractModal
        open={extractModalOpen}
        chains={extractedChains}
        paperId={paperId}
        contextText={extractContext?.text ?? ''}
        contextPage={extractContext?.page ?? 1}
        onClose={() => {
          setExtractModalOpen(false)
          setExtractedChains([])
          setExtractContext(null)
        }}
        onSaved={() => {
          void loadChains()
          void loadExtractions({ force: true })
        }}
      />
    </div>
  )
}

function mergePaperMetadata(
  base: PaperArtifactPayload['metadata'],
  row: LibraryPaperSnapshot,
): PaperArtifactPayload['metadata'] {
  const title = row.title?.trim() || base.title
  const authors = splitPaperAuthors(row.authors)
  const parsedYear = Number.parseInt(row.year ?? '', 10)
  return {
    title,
    authors: authors.length > 0 ? authors : base.authors,
    year: Number.isFinite(parsedYear) ? parsedYear : base.year,
    venue: row.journal?.trim() || base.venue,
    doi: row.doi?.trim() || base.doi,
    abstract: row.abstract?.trim() || base.abstract,
  }
}

function paperMetadataEquals(
  left: PaperArtifactPayload['metadata'],
  right: PaperArtifactPayload['metadata'],
): boolean {
  if (left.title !== right.title) return false
  if (left.year !== right.year) return false
  if (left.venue !== right.venue) return false
  if ((left.doi ?? '') !== (right.doi ?? '')) return false
  if (left.abstract !== right.abstract) return false
  if (left.authors.length !== right.authors.length) return false
  return left.authors.every((author, index) => author === right.authors[index])
}

// ─── Sub-components ──────────────────────────────────────────────

function tabBtn(
  id: SideTab,
  label: string,
  active: SideTab,
  setTab: (t: SideTab) => void,
) {
  const isActive = id === active
  return (
    <button
      key={id}
      onClick={() => setTab(id)}
      className={`card-paper-tab-btn${isActive ? ' is-active' : ''}`}
    >
      {label}
    </button>
  )
}

function AbstractFallback({
  metadata,
}: {
  metadata: PaperArtifactPayload['metadata']
}) {
  // Title is intentionally NOT rendered here — it already shows in the
  // card's top bar. Repeating it stacked "title | authors | abstract"
  // was the core of the "three titles" redundancy.
  return (
    <div className="card-paper-abstract-box" aria-label={metadata.title}>
      <FileText size={22} className="card-paper-abstract-icon" />
      <div className="card-paper-abstract-authors">
        {metadata.authors.join(', ')} {'\u00b7'} {metadata.year}{' '}
        {'\u00b7'} <em>{metadata.venue}</em>
      </div>
      <div className="card-paper-abstract-label">Abstract</div>
      <p className="card-paper-abstract-text">{metadata.abstract}</p>
      <div className="card-paper-abstract-note">
        PDF not attached. Showing abstract preview.
      </div>
    </div>
  )
}

// ─── Whole-paper extraction helpers ─────────────────────────────
//
// Mirrors lattice-cli's section-first strategy: prefer markdown sections
// filtered by keyword + numeric density, split long sections on paragraph
// boundaries with a small overlap, fall back to the concatenated full text
// when no structured sections are available. We intentionally keep the
// per-chunk ceiling below the backend's 8000-char truncation so meaningful
// signal is preserved end-to-end.

type WholePaperChunk = { label: string; text: string }

type SaveChainDraft = SaveChainsRequest['chains'][number]

const WHOLE_EXTRACT_MAX_CHARS = 7000
const WHOLE_EXTRACT_OVERLAP = 400
const WHOLE_EXTRACT_CONCURRENCY = 2
const WHOLE_EXTRACT_FULLTEXT_CAP = 15000
const WHOLE_EXTRACT_MIN_CHARS = 200

const SECTION_KEYWORDS = [
  'experimental',
  'experiment',
  'methods',
  'method',
  'materials and methods',
  'synthesis',
  'preparation',
  'fabrication',
  'characterization',
  'results',
  'discussion',
  'results and discussion',
  'properties',
  'performance',
]

function buildWholePaperChunks(
  raw: Extract<PaperReadResponse, { success: true }>,
): WholePaperChunk[] {
  const sections = Array.isArray(raw.sections) ? raw.sections : []
  if (sections.length > 0) {
    const candidates = pickCandidateSections(sections)
    const picked = candidates.length > 0 ? candidates : sections
    const chunks: WholePaperChunk[] = []
    for (const section of picked) {
      for (const c of splitSectionChunk(section)) chunks.push(c)
    }
    if (chunks.length > 0) return chunks
  }

  const fullText = typeof raw.full_text === 'string' ? raw.full_text : ''
  const trimmedFull = fullText.slice(0, WHOLE_EXTRACT_FULLTEXT_CAP)
  if (trimmedFull.trim().length < WHOLE_EXTRACT_MIN_CHARS) return []
  return splitLongText('Full text', trimmedFull)
}

function pickCandidateSections(
  sections: PaperReadSection[],
): PaperReadSection[] {
  const matched: PaperReadSection[] = []
  for (const section of sections) {
    const title = (section.title ?? '').toLowerCase().trim()
    const content = section.content ?? ''
    if (content.trim().length < WHOLE_EXTRACT_MIN_CHARS) continue
    const byKeyword = SECTION_KEYWORDS.some((kw) => title.includes(kw))
    const byDensity = numericDensity(content) >= 0.015
    if (byKeyword || byDensity) matched.push(section)
  }
  return matched
}

function numericDensity(text: string): number {
  if (!text) return 0
  const digits = text.replace(/[^0-9]/g, '').length
  return digits / text.length
}

function splitSectionChunk(section: PaperReadSection): WholePaperChunk[] {
  const content = (section.content ?? '').trim()
  if (content.length < WHOLE_EXTRACT_MIN_CHARS) return []
  const label = section.title?.trim() || 'Section'
  if (content.length <= WHOLE_EXTRACT_MAX_CHARS) {
    return [{ label, text: content }]
  }
  return splitLongText(label, content)
}

function splitLongText(label: string, text: string): WholePaperChunk[] {
  const max = WHOLE_EXTRACT_MAX_CHARS
  const overlap = Math.min(WHOLE_EXTRACT_OVERLAP, Math.floor(max / 2))
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (paragraphs.length === 0) return []

  const chunks: WholePaperChunk[] = []
  let buffer = ''
  for (const para of paragraphs) {
    if (para.length > max) {
      if (buffer.length > 0) {
        chunks.push({ label: `${label} · ${chunks.length + 1}`, text: buffer })
        buffer = ''
      }
      for (let i = 0; i < para.length; i += max - overlap) {
        const slice = para.slice(i, i + max)
        if (slice.trim().length >= WHOLE_EXTRACT_MIN_CHARS) {
          chunks.push({ label: `${label} · ${chunks.length + 1}`, text: slice })
        }
        if (i + max >= para.length) break
      }
      continue
    }
    const candidate = buffer ? `${buffer}\n\n${para}` : para
    if (candidate.length > max) {
      if (buffer.length >= WHOLE_EXTRACT_MIN_CHARS) {
        chunks.push({ label: `${label} · ${chunks.length + 1}`, text: buffer })
      }
      const tail = buffer.slice(Math.max(0, buffer.length - overlap))
      buffer = tail ? `${tail}\n\n${para}` : para
    } else {
      buffer = candidate
    }
  }
  if (buffer.trim().length >= WHOLE_EXTRACT_MIN_CHARS) {
    chunks.push({ label: `${label} · ${chunks.length + 1}`, text: buffer })
  }
  return chunks
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  onSettled?: (ok: boolean, value: R | undefined, index: number) => void,
): Promise<R[]> {
  const size = items.length
  const results: R[] = new Array(size) as R[]
  if (size === 0) return results
  const concurrency = Math.max(1, Math.min(limit, size))
  let cursor = 0
  const run = async (): Promise<void> => {
    while (true) {
      const i = cursor++
      if (i >= size) return
      try {
        const value = await worker(items[i], i)
        results[i] = value
        onSettled?.(true, value, i)
      } catch {
        onSettled?.(false, undefined, i)
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, run))
  return results.filter((v) => v !== undefined) as R[]
}

function chainToSaveDraft(
  chain: KnowledgeChain,
  contextSection: string,
): SaveChainDraft {
  const nodes = (chain.nodes ?? []).map((n, i) => {
    const node: Omit<ChainNode, 'id' | 'chain_id'> = {
      ordinal: Number.isFinite(n.ordinal) ? n.ordinal : i,
      role: n.role,
      name: n.name,
    }
    if (n.value !== undefined) node.value = n.value
    if (n.value_numeric !== undefined) node.value_numeric = n.value_numeric
    if (n.unit !== undefined) node.unit = n.unit
    if (n.metadata !== undefined) node.metadata = n.metadata
    return node
  })
  const draft: SaveChainDraft = {
    nodes,
    context_section: chain.context_section ?? contextSection,
  }
  if (chain.confidence !== undefined) draft.confidence = chain.confidence
  if (chain.domain_type !== undefined) draft.domain_type = chain.domain_type
  if (chain.chain_type !== undefined) draft.chain_type = chain.chain_type
  if (chain.context_text !== undefined) draft.context_text = chain.context_text
  return draft
}

function chainSig(
  nodes: ReadonlyArray<
    Pick<ChainNode, 'role' | 'name' | 'value'>
  >,
): string {
  return nodes
    .map(
      (n) =>
        `${(n.role ?? '').toLowerCase()}|${(n.name ?? '').trim().toLowerCase()}|${String(n.value ?? '').trim().toLowerCase()}`,
    )
    .join('>>')
}

function dedupeSaveDrafts(
  drafts: SaveChainDraft[],
  existing: KnowledgeChain[],
): SaveChainDraft[] {
  const seen = new Set<string>()
  for (const chain of existing) {
    if (chain.nodes && chain.nodes.length > 0) {
      seen.add(chainSig(chain.nodes))
    }
  }
  const out: SaveChainDraft[] = []
  for (const draft of drafts) {
    if (!draft.nodes || draft.nodes.length === 0) continue
    const sig = chainSig(draft.nodes)
    if (seen.has(sig)) continue
    seen.add(sig)
    out.push(draft)
  }
  return out
}
