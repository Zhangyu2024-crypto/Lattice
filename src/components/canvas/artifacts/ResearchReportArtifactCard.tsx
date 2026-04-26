// Research / survey report artifact — three-pane canvas card.
//
// Pane model (replaces the old two-pane + in-body refs layout):
//   ┌──────────────────────────────────────────────────────────┐
//   │  header: icon + topic + progress chip + actions          │
//   ├─────────┬────────────────────────────────┬───────────────┤
//   │ OUTLINE │ BODY (markdown + cite pills)   │ REFERENCES    │
//   │         │                                │               │
//   └─────────┴────────────────────────────────┴───────────────┘
//
// The left outline and right references pane both scroll independently
// from the center. Clicking a body [N] pill scrolls + flashes the right-
// pane ref; clicking a right-pane ref scrolls the center to the first
// section that cites it. Section-level IntersectionObserver keeps the
// outline's active marker in sync with the center scroll position.
//
// Status chip in the header is the canonical progress indicator — "one
// glance" answers "is the agent still working?" / "what's it drafting?".
// Tool-call cards in the chat transcript stay minimal so the canvas is
// the focus of attention during long runs.
//
// The pane bodies + helpers live in ./research-report/*; this file owns
// the lifecycle (refs, observer, callbacks) and the header chrome.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import {
  AlertTriangle,
  BookOpen,
  FileText,
  Maximize2,
} from 'lucide-react'
import type { Artifact } from '../../../types/artifact'
import { flushRuntimePersist, useRuntimeStore } from '../../../stores/runtime-store'
import { Badge, Button, EmptyState } from '../../ui'
import { StatusChip } from './research-report/bits'
import ResearchExportButton from '../../research/ResearchExportButton'
import OutlinePane from './research-report/OutlinePane'
import BodyPane from './research-report/BodyPane'
import ReferencesPane from './research-report/ReferencesPane'
import {
  buildCitationIndexByFirstUse,
  orderCitationsByIndex,
} from './research-report/helpers'
import { MD_STYLE } from './research-report/styles'
import Resizer from '../../common/Resizer'
import type {
  ReportStatus,
  ResearchReportPayload,
} from './research-report/types'

interface Props {
  artifact: Artifact
  chrome?: 'full' | 'content-only'
  bodyScrollRef?: RefObject<HTMLDivElement | null>
}

/** Best-effort localStorage reader for the resizable-pane state. Guarded
 *  for SSR / disabled-storage environments so the card still mounts with
 *  the supplied fallback. */
function readStoredNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    const n = Number.parseInt(raw, 10)
    return Number.isFinite(n) && n > 0 ? n : fallback
  } catch {
    return fallback
  }
}

export default function ResearchReportArtifactCard({
  artifact,
  chrome = 'full',
  bodyScrollRef: externalBodyScrollRef,
}: Props) {
  const payload = artifact.payload as unknown as ResearchReportPayload
  const sessions = useRuntimeStore((s) => s.sessions)
  const sections = payload?.sections ?? []
  const citations = payload?.citations ?? []
  const reportStatus: ReportStatus = payload?.status ?? 'complete'
  const isPlanning = reportStatus === 'planning'
  const isDrafting = reportStatus === 'drafting'
  const isSurvey = payload?.mode === 'survey'
  const hasUnverifiedCitations = useMemo(
    () => citations.some((c) => c.unverified === true),
    [citations],
  )

  // Citation id → user-facing number (1-based, by first use in the body).
  // Retrieval order can contain hundreds of papers; first-use numbering
  // keeps the visible report reading like a paper instead of showing
  // first-section citations such as [94] or [120].
  const citationIndex = useMemo(() => {
    return buildCitationIndexByFirstUse({ sections, citations })
  }, [sections, citations])
  const orderedCitations = useMemo(
    () => orderCitationsByIndex(citations, citationIndex),
    [citationIndex, citations],
  )

  // Pane widths, persisted per-installation via localStorage. We keep this
  // state local (not in prefs-store) because the widths only matter to
  // this one card — adding them to the shared LayoutPrefs shape would
  // force every consumer to reason about research-card-only keys. Two
  // distinct clamps since the panes serve different purposes (outline is
  // short labels, refs pane is longer bibliography rows).
  const [outlineWidth, setOutlineWidth] = useState<number>(() =>
    readStoredNumber('lattice.researchCard.outlineWidth', 200),
  )
  const [refsWidth, setRefsWidth] = useState<number>(() =>
    readStoredNumber('lattice.researchCard.refsWidth', 280),
  )
  const persistOutlineWidth = useCallback((v: number) => {
    try {
      localStorage.setItem('lattice.researchCard.outlineWidth', String(v))
    } catch {
      // Storage full / disabled — best-effort, in-memory state still works.
    }
  }, [])
  const persistRefsWidth = useCallback((v: number) => {
    try {
      localStorage.setItem('lattice.researchCard.refsWidth', String(v))
    } catch {
      // Same as above.
    }
  }, [])

  // Reverse lookup: citationId → [section numbers] so the references
  // pane can show "cited in §1, §3" without re-scanning bodies.
  const citedInBySection = useMemo(() => {
    const map = new Map<string, number[]>()
    sections.forEach((sec, idx) => {
      const sectionNumber = idx + 1
      for (const cid of sec.citationIds) {
        const list = map.get(cid)
        if (list) list.push(sectionNumber)
        else map.set(cid, [sectionNumber])
      }
    })
    return map
  }, [sections])

  // Forward lookup: citationId → first section index that cites it.
  // Drives "right-pane click → scroll body to first use" interaction.
  const firstSectionForCitation = useMemo(() => {
    const m = new Map<string, number>()
    sections.forEach((sec, idx) => {
      for (const cid of sec.citationIds) {
        if (!m.has(cid)) m.set(cid, idx)
      }
    })
    return m
  }, [sections])

  // Progress labels: what's currently being worked on and how far along.
  const draftedCount = useMemo(
    () =>
      sections.filter(
        (s) => s.status === 'done' || s.markdown.trim().length > 0,
      ).length,
    [sections],
  )
  const currentSection = useMemo(() => {
    if (!payload?.currentSectionId) return null
    return (
      sections.find((s) => s.id === payload.currentSectionId) ?? null
    )
  }, [sections, payload?.currentSectionId])
  const detachSessionId = useMemo(() => {
    if (typeof window === 'undefined') return null
    const currentHash = window.location.hash.replace(/^#\/?/, '')
    if (currentHash.startsWith('workbench')) return null
    for (const session of Object.values(sessions)) {
      if (session.artifacts[artifact.id]) return session.id
    }
    return null
  }, [artifact.id, sessions])
  const canDetach =
    detachSessionId != null &&
    typeof window !== 'undefined' &&
    typeof window.electronAPI?.openWorkbenchWindow === 'function'

  const sectionRefs = useRef<Array<HTMLElement | null>>([])
  const citationRefs = useRef<Map<string, HTMLElement | null>>(new Map())
  const internalBodyScrollRef = useRef<HTMLDivElement | null>(null)
  const bodyScrollRef = externalBodyScrollRef ?? internalBodyScrollRef
  const refsScrollRef = useRef<HTMLDivElement | null>(null)
  const [activeIdx, setActiveIdx] = useState(0)
  const showChrome = chrome === 'full'

  useEffect(() => {
    sectionRefs.current = sectionRefs.current.slice(0, sections.length)
  }, [sections.length])

  useEffect(() => {
    const root = bodyScrollRef.current
    if (!root || sections.length === 0) return
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .map((e) => ({
            idx: Number((e.target as HTMLElement).dataset.sectionIdx),
            ratio: e.intersectionRatio,
            top: e.boundingClientRect.top,
          }))
          .sort((a, b) => b.ratio - a.ratio || a.top - b.top)
        if (visible.length > 0) setActiveIdx(visible[0].idx)
      },
      {
        root,
        rootMargin: '-20% 0px -60% 0px',
        threshold: [0, 0.25, 0.5, 0.75, 1],
      },
    )
    sectionRefs.current.forEach((el) => el && obs.observe(el))
    return () => obs.disconnect()
  }, [sections.length])

  const registerSection = useCallback(
    (idx: number, el: HTMLElement | null) => {
      sectionRefs.current[idx] = el
    },
    [],
  )

  const registerCitation = useCallback(
    (id: string, el: HTMLElement | null) => {
      citationRefs.current.set(id, el)
    },
    [],
  )

  const scrollBodyToSection = useCallback((idx: number) => {
    sectionRefs.current[idx]?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
  }, [])

  const scrollToCitation = useCallback((id: string) => {
    const el = citationRefs.current.get(id)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('is-flash')
    window.setTimeout(() => el.classList.remove('is-flash'), 1400)
  }, [])

  const scrollBodyToCitationSource = useCallback(
    (id: string) => {
      const idx = firstSectionForCitation.get(id)
      if (idx == null) return
      scrollBodyToSection(idx)
    },
    [firstSectionForCitation, scrollBodyToSection],
  )

  const handleDetach = useCallback(() => {
    if (!canDetach || !detachSessionId) return
    flushRuntimePersist()
    void window.electronAPI?.openWorkbenchWindow?.({
      sessionId: detachSessionId,
      artifactId: artifact.id,
    })
  }, [artifact.id, canDetach, detachSessionId])

  if (!payload || sections.length === 0) {
    const EmptyIcon = isSurvey ? BookOpen : FileText
    return (
      <EmptyState
        icon={
          <EmptyIcon
            size={40}
            strokeWidth={1.2}
            className="research-card-empty-icon"
          />
        }
        title={
          isPlanning
            ? 'Planning outline…'
            : payload
              ? 'Agent returned no sections — re-run or edit the prompt.'
              : 'No report content available'
        }
      />
    )
  }

  const modeLabel = 'Research'
  const styleLabel =
    payload.style === 'comprehensive' ? 'Comprehensive' : 'Concise'
  const HeaderIcon = isSurvey ? BookOpen : FileText

  return (
    <div
      className={`research-card-root${showChrome ? '' : ' is-content-only'}`}
    >
      {showChrome && (
        <div className="research-card-header">
          <HeaderIcon
            size={15}
            className={`research-card-header-icon${isSurvey ? ' is-survey' : ''}`}
            aria-hidden
          />
          <strong className="research-card-topic" title={payload.topic}>
            {payload.topic}
          </strong>
          <Badge variant={isSurvey ? 'agent' : 'info'}>{modeLabel}</Badge>
          <Badge variant="neutral">{styleLabel}</Badge>

          <StatusChip
            status={reportStatus}
            totalSections={sections.length}
            draftedSections={draftedCount}
            currentHeading={currentSection?.heading ?? null}
            citationCount={citations.length}
          />

          <span className="research-card-spacer" />

          <ResearchExportButton
            payload={payload}
            bodyScrollRef={bodyScrollRef}
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={!canDetach}
            onClick={handleDetach}
            title={
              canDetach
                ? 'Open in its own window'
                : 'Available only for live session reports'
            }
            leading={<Maximize2 size={12} />}
          >
            Detach
          </Button>
        </div>
      )}

      {showChrome && hasUnverifiedCitations && (
        <div className="research-card-banner" role="note">
          <AlertTriangle size={13} className="research-card-banner-icon" />
          <span>
            Citations drafted by LLM — not yet verified against a source
            library. Double-check each reference before reusing.
          </span>
        </div>
      )}

      <div
        className="research-card-body"
        style={
          {
            '--research-outline-width': `${outlineWidth}px`,
            '--research-refs-width': `${refsWidth}px`,
          } as React.CSSProperties
        }
      >
        <OutlinePane
          sections={sections}
          activeIdx={activeIdx}
          onJumpToSection={scrollBodyToSection}
        />
        <Resizer
          orientation="vertical"
          value={outlineWidth}
          min={140}
          max={400}
          resetTo={200}
          label="Left splitter"
          onDraft={setOutlineWidth}
          onCommit={(v) => {
            setOutlineWidth(v)
            persistOutlineWidth(v)
          }}
        />
        <BodyPane
          sections={sections}
          citations={orderedCitations}
          citationIndex={citationIndex}
          onCiteClick={scrollToCitation}
          scrollRef={bodyScrollRef}
          registerSection={registerSection}
        />
        <Resizer
          orientation="vertical"
          invert
          value={refsWidth}
          min={200}
          max={520}
          resetTo={280}
          label="Right splitter"
          onDraft={setRefsWidth}
          onCommit={(v) => {
            setRefsWidth(v)
            persistRefsWidth(v)
          }}
        />
        <ReferencesPane
          citations={orderedCitations}
          citationIndex={citationIndex}
          citedInBySection={citedInBySection}
          isPlanning={isPlanning}
          isDrafting={isDrafting}
          scrollRef={refsScrollRef}
          registerCitation={registerCitation}
          onJumpToCitationSource={scrollBodyToCitationSource}
        />
      </div>

      <style>{MD_STYLE}</style>
    </div>
  )
}
