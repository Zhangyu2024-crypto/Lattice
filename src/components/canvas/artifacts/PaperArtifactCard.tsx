// PaperArtifactCard — full PDF reader with 3-tab side panel.
//
// Layout: [ PDF viewer | draggable split | Side panel ] — ratio persisted in
// localStorage. Side tabs: Annotations | AI Ask | Info
// Text selection: floating menu -> highlight / note / ask
//
// Mirrors lattice-cli's `app.js` PDF reader (lines 3278-4466).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Copy,
  Download,
  ExternalLink,
  FileText,
  Tag,
} from 'lucide-react'
import type { Artifact } from '../../../types/artifact'
import type {
  PaperAnnotation,
  UpdateAnnotationRequest,
} from '../../../types/library-api'
import type { PaperArtifactPayload } from '../../../stores/demo-library'
import { useRuntimeStore } from '../../../stores/runtime-store'
import { localProLibrary } from '../../../lib/local-pro-library'
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
import {
  Badge,
  Button,
} from '../../ui'
import AnnotationsTab, { type SideTab } from './paper/tabs/AnnotationsTab'
import type { AiMessage } from './paper/tabs/AiAskTab'
import AiAskTab from './paper/tabs/AiAskTab'
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
  // Self-contained Port §P3 v3 — library facade is always "ready"
  // whenever the Electron shell is running. Annotations persist locally;
  // RAG / PDF features throw with a descriptive message until the P4
  // Python worker lands.
  const libApi = localProLibrary
  const activeSessionId = useRuntimeStore((s) => s.activeSessionId)
  const patchArtifact = useRuntimeStore((s) => s.patchArtifact)

  const [tab, setTab] = useState<SideTab>('annotations')
  const [resolvedMetadata, setResolvedMetadata] = useState(metadata)

  // Annotations from the local library store.
  const [annotations, setAnnotations] = useState<PaperAnnotation[]>([])
  const [annotationsLoading, setAnnotationsLoading] = useState(false)

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

  // Info tab lazy data: full text is fetched on demand and cached. Full
  // text can be large, so keep it behind a user toggle.
  const [fullText, setFullText] = useState<string | null>(null)
  const [fullTextLoading, setFullTextLoading] = useState(false)
  const [fullTextError, setFullTextError] = useState<string | null>(null)
  const [showFullText, setShowFullText] = useState(false)

  // Inline annotation editor
  const [editingAnnId, setEditingAnnId] = useState<number | null>(null)
  const [editDraftContent, setEditDraftContent] = useState('')
  const [editDraftColor, setEditDraftColor] = useState('#D4D4D4')
  const [editSaving, setEditSaving] = useState(false)

  // Derive the paperId (local library integer ID) from the artifact. Demo papers use
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
      // Local annotation storage may be unavailable in pure-Vite mode.
    } finally {
      setAnnotationsLoading(false)
    }
  }, [libApi, paperId])

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

  useEffect(() => {
    void loadAnnotations()
  }, [loadAnnotations])

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
            toast.warn('Annotations require a local library paper')
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
            toast.warn('Annotations require a local library paper')
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
      }
    },
    [selection, paperId, libApi, loadAnnotations, artifact.id, artifact.title],
  )

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
        toast.warn('Annotations require local library storage')
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
            {tabBtn('info', 'Info', tab, setTab)}
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
            {tab === 'info' && (
              <InfoTab
                metadata={resolvedMetadata}
                paperId={paperId}
                annotationCount={annotations.length}
                localTextAvailable={libApi.ready && paperId != null}
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
