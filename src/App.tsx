import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from './stores/app-store'
import { useModalStore } from './stores/modal-store'
import { useAppShortcuts } from './hooks/useAppShortcuts'
import { useEscapeKey } from './hooks/useEscapeKey'
import { renderArtifactBody } from './components/canvas/artifact-body'
import { useWebSocket } from './hooks/useWebSocket'
import {
  flushRuntimePersist,
  genArtifactId,
  getActiveTranscript,
  selectActiveSession,
  useRuntimeStore,
} from './stores/runtime-store'
import { DEMO_PEAK_FIT, DEMO_SPECTRUM } from './stores/demo-data'
import { DEMO_XRD_ANALYSIS } from './stores/demo-xrd'
import { DEMO_XPS_ANALYSIS } from './stores/demo-xps'
import { DEMO_RAMAN_ID } from './stores/demo-raman'
import { DEMO_JOB_MONITOR } from './stores/demo-job'
import { DEMO_COMPUTE } from './stores/demo-compute'
import { DEMO_STRUCTURE } from './stores/demo-structure'
import { DEMO_RESEARCH_REPORT } from './stores/demo-research-report'
import { DEMO_BATCH_WORKFLOW } from './stores/demo-batch'
import { DEMO_MATERIAL_COMPARISON } from './stores/demo-material-comparison'
import { DEMO_SIMILARITY_MATRIX } from './stores/demo-similarity'
import { DEMO_LIBRARY, DEMO_PAPER_ARTIFACT } from './stores/demo-library'
import {
  usePrefsStore,
  EDITOR_PANE_HEIGHT_MIN,
  type SidebarView,
} from './stores/prefs-store'
import { useUsageStore } from './stores/usage-store'
import { useLLMConfigStore, useResolvedModel } from './stores/llm-config-store'
import { calculateTokenWarningState } from './lib/context-window'
import { log } from './lib/logger'
import type { ContextSnapshot } from './components/layout/StatusBar'
import { DEMO_OPTIMIZATION } from './stores/demo-optimization'
import { DEMO_HYPOTHESIS } from './stores/demo-hypothesis'
import { DEMO_LATEX, EMPTY_LATEX } from './stores/demo-latex'
import { findLatexTemplate } from './stores/latex-templates'
import type { LatexDocumentPayload } from './types/latex'
import ApprovalDialog from './components/agent/ApprovalDialog'
import AskDialog from './components/agent/AskDialog'
import ActivityBar from './components/layout/ActivityBar'
import Sidebar from './components/layout/Sidebar'
import StatusBar from './components/layout/StatusBar'
import CommandPalette from './components/common/CommandPalette'
import DragOverlay from './components/common/DragOverlay'
import MigrationDialog from './components/common/MigrationDialog'
import ProLauncherMenu from './components/common/ProLauncherMenu'
import PaperReaderLauncherPanel from './components/layout/PaperReaderLauncherPanel'
import Resizer from './components/common/Resizer'

const LazyLatexDocumentCard = lazy(
  () => import('./components/canvas/artifacts/latex/LatexDocumentCard'),
)
const LazyComputeNotebook = lazy(
  () => import('./components/compute/notebook/ComputeNotebook'),
)
import {
  createProWorkbench,
  latestSpectrumFromSession,
  type ProWorkbenchKind,
} from './lib/pro-workbench'
import type { SpectrumTechnique } from './types/artifact'
import ToastHost from './components/common/ToastHost'
import LogConsole from './components/common/LogConsole'
import PromptHost from './components/common/PromptHost'
import { type SettingsTabId } from './components/layout/SettingsModal'
import WorkspaceRail, {
  type WorkspaceRailTab,
} from './components/layout/WorkspaceRail'
import WorkspaceTopbar from './components/layout/WorkspaceTopbar'
import AgentComposer from './components/agent/AgentComposer'
import EditorArea from './components/editor/EditorArea'
import { useEditorStore } from './stores/editor-store'
import { useWorkspaceStore } from './stores/workspace-store'
import { toast } from './stores/toast-store'
import { submitAgentPrompt } from './lib/agent-submit'
import { dispatchComposerPrefill } from './lib/composer-bus'
import {
  useComputeOverlayListener,
  type OpenComputeOverlayRequest,
} from './lib/compute-overlay-bus'
import { buildAutoResearchScaffold } from './lib/research-prompts'
import { formatPaperArtifactTitle } from './lib/paper-metadata'
import type {
  LatexDocumentArtifact,
  PeakFitArtifact,
  SpectrumArtifact,
} from './types/artifact'
import type {
  LibraryOpenPaperIpcPayload,
} from './types/electron'

// Modal code is lazy-loaded — most sessions never open Settings /
// Library, and keeping them off the critical path shaves the initial
// bundle. Opener buttons prefetch on mouseenter so the click-open path
// is still instant after hover warmup.
const LibraryModal = lazy(() => import('./components/library/LibraryModal'))
const SettingsModal = lazy(() => import('./components/layout/SettingsModal'))

const prefetchLibraryModal = () =>
  void import('./components/library/LibraryModal')
const prefetchSettingsModal = () =>
  void import('./components/layout/SettingsModal')

const WORKSPACE_EDITOR_PANE_RESET = 320
const WORKSPACE_COMPOSER_PANE_MIN = 220
const WORKSPACE_SPLIT_HANDLE_PX = 6

if (import.meta.env.DEV) {
  void import('./dev/mock-agent-stream')
}

export default function App() {
  const hasOpenFiles = useEditorStore((s) => Object.keys(s.openFiles).length)
  // Modal / overlay open-close state + payloads live in `modal-store.ts`.
  // App.tsx subscribes via selectors and mutates through the store's
  // setters; anywhere else in the app (bus listeners, agent tool
  // responses, palette commands) can reach the same state without
  // drilling a callback down through props.
  const paletteOpen = useModalStore((s) => s.paletteOpen)
  const setPaletteOpen = useModalStore((s) => s.setPaletteOpen)
  const settingsOpen = useModalStore((s) => s.settingsOpen)
  const settingsTab = useModalStore((s) => s.settingsTab)
  const setSettingsOpen = useModalStore((s) => s.setSettingsOpen)
  const toggleSettingsTab = useModalStore((s) => s.toggleSettingsTab)
  const libraryOpen = useModalStore((s) => s.libraryOpen)
  const setLibraryOpen = useModalStore((s) => s.setLibraryOpen)
  const proLauncherOpen = useModalStore((s) => s.proLauncherOpen)
  const setProLauncherOpen = useModalStore((s) => s.setProLauncherOpen)
  const paperReaderLauncher = useModalStore((s) => s.paperReader)
  const setPaperReaderLauncher = useModalStore((s) => s.setPaperReader)

  // Research is an agent-mode flow: same session thread, local research_*
  // tools, raised iteration budget. Start a new session when the current
  // one already has chat history.
  const ensureAgentThreadForResearchFlow = useCallback(() => {
    const store = useRuntimeStore.getState()
    const sid =
      store.activeSessionId ?? store.createSession({ title: 'Session 1' })
    const ses = useRuntimeStore.getState().sessions[sid]
    const title = 'Research'

    if (!ses) return sid
    if (ses.transcript.length === 0) {
      store.setChatMode(sid, 'agent')
      store.renameSession(sid, title)
      return sid
    }
    return store.createSession({ title })
  }, [])

  // Layout (sidebar / chat width + editor-pane height + visibility) is
  // persisted via prefs-store.
  // During a drag we update a local draft + ref at 60fps for immediate
  // visual feedback, then commit the final width once on mouseup to avoid
  // hammering localStorage.
  const layout = usePrefsStore((s) => s.layout)
  const setLayout = usePrefsStore((s) => s.setLayout)
  const setActiveView = usePrefsStore((s) => s.setActiveView)
  const setRightRailTab = useCallback(
    (tab: WorkspaceRailTab) => setLayout({ lastRightRailTab: tab }),
    [setLayout],
  )
  const [sidebarWidthDraft, setSidebarWidthDraft] = useState(layout.sidebarWidth)
  const [chatWidthDraft, setChatWidthDraft] = useState(layout.chatWidth)
  const [editorPaneHeightDraft, setEditorPaneHeightDraft] = useState(
    layout.editorPaneHeight,
  )
  const sidebarWidthRef = useRef(layout.sidebarWidth)
  const chatWidthRef = useRef(layout.chatWidth)
  const editorPaneHeightRef = useRef(layout.editorPaneHeight)
  const workspaceMainBodyRef = useRef<HTMLDivElement | null>(null)
  const [workspaceMainBodyHeight, setWorkspaceMainBodyHeight] = useState(0)

  // Warm the slash-command caches (skills / plugins / MCP) from disk and
  // re-warm whenever the main process reports a change. Also re-warm
  // plugins + MCP when the user flips toggles in Settings → Extensions so
  // the `/` typeahead updates without an app reload. Loaders no-op in
  // Vite-only mode (no electronAPI).
  useEffect(() => {
    const unsubs: Array<() => void> = []
    let cancelled = false
    void Promise.all([
      import('./lib/slash-commands'),
      import('./stores/extensions-config-store'),
    ]).then(([slash, store]) => {
      if (cancelled) return
      const warmSkills = () => void slash.warmSkillsCache()
      const warmPlugins = () => void slash.warmPluginsCache()
      const warmMcp = () => void slash.warmMcpCache()
      warmSkills()
      warmPlugins()
      warmMcp()
      const api = window.electronAPI
      if (api?.onSkillsChanged) unsubs.push(api.onSkillsChanged(warmSkills))
      if (api?.onPluginsChanged) unsubs.push(api.onPluginsChanged(warmPlugins))
      if (api?.onMcpPromptsChanged)
        unsubs.push(api.onMcpPromptsChanged(warmMcp))
      unsubs.push(
        store.useExtensionsConfigStore.subscribe((s, prev) => {
          if (s.plugins !== prev.plugins) warmPlugins()
          if (s.mcpServers !== prev.mcpServers) warmMcp()
        }),
      )
    })
    return () => {
      cancelled = true
      for (const u of unsubs) u()
    }
  }, [])

  // Keep draft + ref in sync when the persisted value changes from another
  // source (e.g. future layout preset picker, or store migration).
  useEffect(() => {
    sidebarWidthRef.current = layout.sidebarWidth
    setSidebarWidthDraft(layout.sidebarWidth)
  }, [layout.sidebarWidth])
  useEffect(() => {
    chatWidthRef.current = layout.chatWidth
    setChatWidthDraft(layout.chatWidth)
  }, [layout.chatWidth])
  useEffect(() => {
    editorPaneHeightRef.current = layout.editorPaneHeight
    setEditorPaneHeightDraft(layout.editorPaneHeight)
  }, [layout.editorPaneHeight])
  useEffect(() => {
    const node = workspaceMainBodyRef.current
    if (!node) return
    const measure = (height: number) => {
      setWorkspaceMainBodyHeight(Math.round(height))
    }
    measure(node.getBoundingClientRect().height)
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      measure(entry.contentRect.height)
    })
    ro.observe(node)
    return () => ro.disconnect()
  }, [])

  const editorPaneMax = useMemo(() => {
    if (workspaceMainBodyHeight <= 0) return layout.editorPaneHeight
    return Math.max(
      EDITOR_PANE_HEIGHT_MIN,
      workspaceMainBodyHeight -
        WORKSPACE_COMPOSER_PANE_MIN -
        WORKSPACE_SPLIT_HANDLE_PX,
    )
  }, [layout.editorPaneHeight, workspaceMainBodyHeight])
  const editorPaneHeight = Math.max(
    EDITOR_PANE_HEIGHT_MIN,
    Math.min(editorPaneHeightDraft, editorPaneMax),
  )

  const toggleSidebar = useCallback(
    () =>
      setLayout({
        sidebarVisible: !usePrefsStore.getState().layout.sidebarVisible,
      }),
    [setLayout],
  )
  const toggleRightRail = useCallback(
    () =>
      setLayout({
        chatVisible: !usePrefsStore.getState().layout.chatVisible,
      }),
    [setLayout],
  )
  const openRightRailTab = useCallback(
    (_tab: WorkspaceRailTab) => {
      setLayout({ chatVisible: true, lastRightRailTab: 'details' })
    },
    [setLayout],
  )
  // Reads both `chatVisible` and `lastRightRailTab` from the same store
  // snapshot so rapid keyboard toggles can't race a stale React-state value.
  const toggleInspector = useCallback(() => {
    const current = usePrefsStore.getState().layout
    if (current.chatVisible && current.lastRightRailTab === 'details') {
      setLayout({ chatVisible: false })
      return
    }
    setLayout({ chatVisible: true, lastRightRailTab: 'details' })
  }, [setLayout])

  const handleOpenLibrary = useCallback(async () => {
    if (window.electronAPI?.openLibraryWindow) {
      try {
        const r = await window.electronAPI.openLibraryWindow()
        if (r && !r.success && r.error) {
          toast.error(`Could not open Library: ${r.error}`)
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Could not open Library window',
        )
      }
      return
    }
    prefetchLibraryModal()
    setLibraryOpen(true)
  }, [])

  const ensureLatexArtifact = useCallback((seed: LatexDocumentPayload) => {
    const store = useRuntimeStore.getState()
    const sid = store.activeSessionId ?? store.createSession({ title: 'Writing' })
    const existing = store.findArtifactByKind(sid, 'latex-document')
    if (existing) return { sid, aid: existing.id }
    const aid = genArtifactId()
    const artifact: LatexDocumentArtifact = {
      id: aid,
      kind: 'latex-document',
      title: 'Untitled document',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      payload: seed,
    }
    store.upsertArtifact(sid, artifact)
    return { sid, aid }
  }, [])

  const computeOverlayOpen = useModalStore((s) => s.computeOverlayOpen)
  const computeSpawn = useModalStore((s) => s.computeSpawn)
  const computeFocusCellId = useModalStore((s) => s.computeFocusCellId)
  const openComputeOverlay = useModalStore((s) => s.openComputeOverlay)
  const closeComputeOverlay = useModalStore((s) => s.closeComputeOverlay)
  const consumeComputeSpawn = useModalStore((s) => s.consumeComputeSpawn)
  const consumeComputeFocusCell = useModalStore((s) => s.consumeComputeFocusCell)
  // Deep-linked openers (artifact-body / file-tree launcher / future agent
  // tool cards) fire `openComputeOverlay()` on the window bus; route the
  // payload through the store action so spawn + focus fields land atomically.
  useComputeOverlayListener(openComputeOverlay)
  const creatorOverlay = useModalStore((s) => s.creatorOverlay)
  const setCreatorOverlay = useModalStore((s) => s.setCreatorOverlay)
  const artifactOverlay = useModalStore((s) => s.artifactOverlay)
  const setArtifactOverlay = useModalStore((s) => s.setArtifactOverlay)

  const openCreatorInline = useCallback(
    (sid: string, aid: string) => {
      const store = useRuntimeStore.getState()
      store.setActiveSession(sid)
      store.focusArtifact(sid, aid)
      setCreatorOverlay({ sessionId: sid, artifactId: aid })
    },
    [setCreatorOverlay],
  )

  const handleOpenWriting = useCallback(async () => {
    const { sid, aid } = ensureLatexArtifact(DEMO_LATEX)
    openCreatorInline(sid, aid)
  }, [ensureLatexArtifact, openCreatorInline])

  const loadLatexDemo = useCallback(() => {
    const { sid, aid } = ensureLatexArtifact(DEMO_LATEX)
    openCreatorInline(sid, aid)
    toast.info('Demo loaded')
  }, [ensureLatexArtifact, openCreatorInline])

  const newLatexDocument = useCallback(() => {
    const { sid, aid } = ensureLatexArtifact(EMPTY_LATEX)
    openCreatorInline(sid, aid)
  }, [ensureLatexArtifact, openCreatorInline])

  // Unlike demo / empty (which reuse the session's existing latex artifact
  // via ensureLatexArtifact), journal templates always create a fresh
  // document so the user can keep a working draft and still try another
  // template without overwriting it.
  const loadLatexTemplate = useCallback(
    (templateId: string) => {
      const template = findLatexTemplate(templateId)
      if (!template) {
        toast.warn(`Unknown template: ${templateId}`)
        return
      }
      const store = useRuntimeStore.getState()
      const sid =
        store.activeSessionId ?? store.createSession({ title: 'Writing' })
      const aid = genArtifactId()
      const artifact: LatexDocumentArtifact = {
        id: aid,
        kind: 'latex-document',
        title: template.docTitle,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        payload: template.payload,
      }
      store.upsertArtifact(sid, artifact)
      openCreatorInline(sid, aid)
      toast.info(`Loaded template: ${template.name}`)
    },
    [openCreatorInline],
  )

  // Mouse-invoked view switch (ActivityBar icon click): clicking a
  // different view switches + expands; clicking the active view's icon
  // collapses the sidebar (VSCode behaviour).
  const selectSidebarView = useCallback(
    (view: SidebarView) => {
      const current = usePrefsStore.getState().layout
      if (current.activeView !== view) {
        setActiveView(view)
        setLayout({ sidebarVisible: true })
        return
      }
      setLayout({ sidebarVisible: !current.sidebarVisible })
    },
    [setActiveView, setLayout],
  )

  const setBackend = useAppStore((s) => s.setBackend)
  useWebSocket()

  // Phase 6 — bootstrap: the agent runtime still expects at least one
  // in-memory session (chat + task machinery). We create one lazily here,
  // using `.getState()` so App.tsx does not subscribe to runtime-store.
  // The session-bridge will activate the correct session when the user
  // opens a `.chat.json` file; this is just the safety net.
  useEffect(() => {
    const store = useRuntimeStore.getState()
    if (!store.activeSessionId) {
      store.createSession({ title: 'Session 1' })
    }
  }, [])

  // Session ↔ file bridge: when the user switches to a `.chat.json` tab
  // in the editor, automatically activate the corresponding runtime-store
  // session so AgentComposer shows that conversation.
  useEffect(() => {
    let cleanup: (() => void) | null = null
    void import('./lib/workspace/session-bridge').then((m) => {
      cleanup = m.initSessionBridge()
    })
    return () => cleanup?.()
  }, [])

  // Wire optional legacy bridge status to app-store + toast.
  useEffect(() => {
    const cleanup = window.electronAPI?.onBackendStatus((status) => {
      const wasReady = useAppStore.getState().backend.ready
      setBackend({
        ready: status.ready,
        port: status.port ?? 0,
        token: status.token ?? '',
        baseUrl: status.port ? `http://localhost:${status.port}` : '',
      })
      if (wasReady && !status.ready) {
        toast.warn('Legacy bridge disconnected; continuing in local mode')
      } else if (!wasReady && status.ready) {
        toast.success(`Legacy bridge connected on port ${status.port}`)
      }
    })
    window.electronAPI
      ?.getBackendInfo()
      .then((info) => {
        if (info?.ready) setBackend(info)
      })
      .catch(() => {})
    return cleanup
  }, [setBackend])

  const loadDemo = useCallback(() => {
    const store = useRuntimeStore.getState()
    const sid = store.activeSessionId ?? store.createSession({ title: 'Demo' })
    const spectrumId = genArtifactId()
    const spectrum: SpectrumArtifact = {
      id: spectrumId,
      kind: 'spectrum',
      title: `Spectrum — ${DEMO_SPECTRUM.file}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sourceFile: DEMO_SPECTRUM.file,
      payload: {
        x: DEMO_SPECTRUM.x,
        y: DEMO_SPECTRUM.y,
        xLabel: DEMO_SPECTRUM.xLabel,
        yLabel: DEMO_SPECTRUM.yLabel,
        spectrumType: DEMO_SPECTRUM.spectrumType,
        processingChain: [],
      },
    }
    store.upsertArtifact(sid, spectrum)

    const peakFit: PeakFitArtifact = {
      id: genArtifactId(),
      kind: 'peak-fit',
      title: 'Peak Fit (demo)',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      parents: [spectrumId],
      payload: { ...DEMO_PEAK_FIT, spectrumId },
    }
    store.upsertArtifact(sid, peakFit)
    store.focusArtifact(sid, spectrumId)
    store.appendArtifactCardMessage(sid, spectrumId)
    store.appendArtifactCardMessage(sid, peakFit.id)
    toast.info('Demo BaTiO3 XRD loaded')
  }, [])

  const openFile = useCallback(() => {
    if (window.electronAPI) {
      window.electronAPI.openFile().then((path) => {
        if (path) loadDemo()
      })
    } else {
      loadDemo()
    }
  }, [loadDemo])

  const handleNewSession = useCallback(() => {
    const store = useRuntimeStore.getState()
    const next = store.sessionOrder.length + 1
    const id = store.createSession({ title: `Session ${next}` })
    store.setActiveSession(id)
  }, [])

  const handleRunAgent = useCallback((prompt: string) => {
    const ses = selectActiveSession(useRuntimeStore.getState())
    if (!ses) return
    submitAgentPrompt(prompt, {
      sessionId: ses.id,
      transcript: getActiveTranscript(ses),
    })
  }, [])
  const handleMockAgentStream = useCallback(() => {
    if (!import.meta.env.DEV) return
    const emit = window.__latticeMockAgentStream
    if (typeof emit !== 'function') {
      toast.warn('Mock agent stream is not available')
      return
    }
    const ses = selectActiveSession(useRuntimeStore.getState())
    emit(ses?.id)
    toast.success('Mock agent stream emitted')
  }, [])

  const loadArtifactDemo = useCallback(
    (
      kind:
        | 'xrd-analysis'
        | 'xps-analysis'
        | 'raman-id'
        | 'job'
        | 'compute'
        | 'structure'
        | 'research-report'
        | 'batch'
        | 'material-comparison'
        | 'similarity-matrix'
        | 'paper'
        | 'optimization'
        | 'hypothesis',
      title: string,
      payload: unknown,
      options?: {
        sourceFile?: string
        preserveFocus?: boolean
        skipToast?: boolean
      },
    ) => {
      const store = useRuntimeStore.getState()
      const sid = store.activeSessionId ?? store.createSession({ title: 'Demo' })
      const id = genArtifactId()
      store.upsertArtifact(
        sid,
        {
          id,
          kind,
          title,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          sourceFile: options?.sourceFile,
          payload: payload as never,
        } as never,
        { preserveFocus: options?.preserveFocus },
      )
      if (!options?.preserveFocus) {
        store.focusArtifact(sid, id)
      }
      // Phase δ — surface the new artifact as an inline chat card so it
      // doesn't disappear into the (chat-first) workspace invisibly.
      store.appendArtifactCardMessage(sid, id)
      if (!options?.skipToast) {
        toast.info(`Loaded demo: ${title}`)
      }
      return id
    },
    [],
  )

  const handleOpenPaper = useCallback(
    (
      paperId: string,
      metadata: { title: string; authors: string[]; year: number; venue: string; doi?: string },
      abstract: string,
      presentation: 'embedded' | 'floating' = 'embedded',
    ) => {
      const store = useRuntimeStore.getState()
      const sid =
        store.activeSessionId ?? store.createSession({ title: 'Session 1' })
      const nextTitle = formatPaperArtifactTitle(
        metadata.title,
        metadata.authors,
        metadata.doi,
      )
      const session = store.sessions[sid]
      const existing = (session?.artifactOrder ?? [])
        .map((id) => session?.artifacts[id])
        .find((artifact) => {
          if (!artifact || artifact.kind !== 'paper') return false
          const payload = artifact.payload as {
            paperId?: string
            metadata?: { title?: string }
          }
          return payload.paperId === paperId
        })

      if (existing) {
        store.patchArtifact(sid, existing.id, {
          title: nextTitle,
          payload: {
            ...(existing.payload as object),
            paperId,
            metadata: {
              ...DEMO_PAPER_ARTIFACT.metadata,
              ...metadata,
              abstract,
            },
          } as never,
        })
        if (presentation === 'floating') {
          setPaperReaderLauncher({ sessionId: sid, artifactId: existing.id })
        } else {
          store.focusArtifact(sid, existing.id)
        }
        setLibraryOpen(false)
        return
      }

      const id = loadArtifactDemo(
        'paper',
        nextTitle,
        {
          ...DEMO_PAPER_ARTIFACT,
          paperId,
          metadata: { ...DEMO_PAPER_ARTIFACT.metadata, ...metadata, abstract },
        },
        {
          preserveFocus: presentation === 'floating',
          skipToast: presentation === 'floating',
        },
      )
      if (presentation === 'floating' && id) {
        setPaperReaderLauncher({ sessionId: sid, artifactId: id })
      }
      setLibraryOpen(false)
    },
    [loadArtifactDemo],
  )

  useEffect(() => {
    const cleanup = window.electronAPI?.onLibraryOpenPaper?.(
      (payload: LibraryOpenPaperIpcPayload) => {
        handleOpenPaper(
          payload.paperId,
          payload.metadata,
          payload.abstract,
        )
      },
    )
    return cleanup
  }, [handleOpenPaper])

  const handleOpenMaterialComparison = useCallback(
    (payload: unknown, title: string) => {
      loadArtifactDemo('material-comparison', title, payload)
    },
    [loadArtifactDemo],
  )

  const openProWorkbench = useCallback(
    (kind: ProWorkbenchKind, technique?: SpectrumTechnique) => {
      const store = useRuntimeStore.getState()
      const sid =
        store.activeSessionId ?? store.createSession({ title: 'Session 1' })
      const spectrum =
        kind === 'compute-pro' ? null : latestSpectrumFromSession(sid)

      // Phase 5: all new Pro spectroscopy work funnels through
      // `spectrum-pro`. Legacy kinds (`xrd-pro` / `xps-pro` / `raman-pro` /
      // `curve-pro`) remain callable from older entry points, but we remap
      // them to `spectrum-pro` + an inferred technique hint here and warn
      // the user so the next iteration of those call sites is obvious.
      let effectiveKind: ProWorkbenchKind = kind
      let effectiveTechnique: SpectrumTechnique | undefined = technique
      if (
        kind === 'xrd-pro' ||
        kind === 'xps-pro' ||
        kind === 'raman-pro' ||
        kind === 'curve-pro'
      ) {
        const inferred: SpectrumTechnique =
          kind === 'xrd-pro'
            ? 'xrd'
            : kind === 'xps-pro'
              ? 'xps'
              : kind === 'raman-pro'
                ? 'raman'
                : 'curve'
        toast.warn(
          `Legacy '${kind}' workbench is deprecated — opening as Spectrum Lab (${inferred.toUpperCase()}).`,
        )
        effectiveKind = 'spectrum-pro'
        effectiveTechnique = effectiveTechnique ?? inferred
      }

      const openInNewWindow = Boolean(window.electronAPI?.openWorkbenchWindow)
      const id = createProWorkbench({
        sessionId: sid,
        kind: effectiveKind,
        spectrum,
        technique: effectiveTechnique,
        openInNewWindow,
      })
      if (openInNewWindow && window.electronAPI?.openWorkbenchWindow) {
        flushRuntimePersist()
        void window.electronAPI.openWorkbenchWindow({
          sessionId: sid,
          artifactId: id,
        })
      } else {
        useModalStore.getState().setArtifactOverlay({
          sessionId: sid,
          artifactId: id,
        })
      }
      const label =
        effectiveKind === 'compute-pro'
          ? 'Compute'
          : effectiveTechnique === 'xps'
            ? 'XPS'
            : 'XRD'
      store.appendArtifactCardMessage(sid, id)
      toast.info(`Opened ${label} Lab`)
    },
    [],
  )

  const handleSpectrumFileIntercept = useCallback(
    (file: { name: string; path: string }): boolean => {
      const ext = file.name.toLowerCase().split('.').pop() ?? ''
      const spectrumExts = [
        'xy',
        'xrdml',
        'dat',
        'txt',
        'csv',
        'raman',
        'spc',
      ]
      if (!spectrumExts.includes(ext)) return false
      // Phase 5: when Electron is available, jump straight into a
      // `spectrum-pro` workbench on the satellite window — that's the
      // primary UX now, and the launcher menu would only ever route here
      // anyway. The workbench auto-inherits the latest session spectrum
      // inside `openProWorkbench`. On the web (or if the Electron bridge
      // is missing) we keep the picker fallback so the user still has a
      // way in.
      if (window.electronAPI?.openWorkbenchWindow) {
        openProWorkbench('spectrum-pro')
        return true
      }
      setProLauncherOpen(true)
      return true
    },
    [openProWorkbench],
  )

  // Phase 6: session export is retired. The workspace folder is now the
  // canonical artifact of a session — users copy / archive it directly.
  const handleExportSession = useCallback(() => {
    toast.info(
      'Session export retired. Your workspace folder is the session archive now.',
    )
  }, [])

  const handleExportSessionZip = useCallback(() => {
    toast.info(
      'Session ZIP export retired. Archive your workspace folder directly.',
    )
  }, [])

  const handleOpenSettings = useCallback(() => {
    prefetchSettingsModal()
    setSettingsOpen(true, 'compute')
  }, [setSettingsOpen])

  const openSettingsTab = useCallback(
    (tab: SettingsTabId) => {
      prefetchSettingsModal()
      setSettingsOpen(true, tab)
    },
    [setSettingsOpen],
  )

  const handleToggleSettingsTab = useCallback(
    (tab: SettingsTabId) => {
      prefetchSettingsModal()
      toggleSettingsTab(tab)
    },
    [toggleSettingsTab],
  )

  const handleStartResearch = useCallback(
    (topic?: string) => {
      ensureAgentThreadForResearchFlow()
      const trimmed = topic?.trim()
      // Slash-command path with an explicit topic submits the scaffold
      // itself, so this hook only prepares the research thread.
      if (trimmed) return
      dispatchComposerPrefill({
        text: buildAutoResearchScaffold(),
        mode: 'agent',
        append: true,
        maxIterations: 12,
      })
    },
    [ensureAgentThreadForResearchFlow],
  )

  const workspaceSurfaceTitle = 'Workspace'
  const workspaceRailTabs: WorkspaceRailTab[] = ['details']
  const activeWorkspaceRailTab: WorkspaceRailTab = 'details'
  const workspaceRootPath = useWorkspaceStore((s) => s.rootPath)
  const workspaceBreadcrumbLabel = useMemo(() => {
    if (!workspaceRootPath) return 'No workspace'
    const segs = workspaceRootPath.split(/[\\/]/).filter(Boolean)
    return segs.length ? segs[segs.length - 1] : workspaceRootPath
  }, [workspaceRootPath])

  useAppShortcuts({
    toggleSidebar,
    toggleRightRail,
    openRightRailTab,
    toggleSettingsTab: handleToggleSettingsTab,
    toggleInspector,
    handleOpenLibrary,
    openFile,
    chatVisible: layout.chatVisible,
    activeWorkspaceRailTab,
  })

  return (
    <>
      <ToastHost />
      <LogConsole />
      <PromptHost />
      <MigrationDialog />
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal
            open={settingsOpen}
            initialTab={settingsTab}
            onClose={() => setSettingsOpen(false)}
          />
        </Suspense>
      )}
      <DragOverlay
        onFileDrop={() => loadDemo()}
        onIntercept={handleSpectrumFileIntercept}
      />
      <ProLauncherMenu
        open={proLauncherOpen}
        onClose={() => setProLauncherOpen(false)}
        onSelect={(kind) => openProWorkbench(kind)}
      />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onLoadDemo={loadDemo}
        onToggleSidebar={toggleSidebar}
        onToggleChat={toggleRightRail}
        onOpenFile={openFile}
        onNewSession={handleNewSession}
        onExportSession={handleExportSession}
        onLoadXrdDemo={() =>
          loadArtifactDemo('xrd-analysis', 'XRD Analysis (BaTiO3 + TiO2)', DEMO_XRD_ANALYSIS)
        }
        onLoadXpsDemo={() =>
          loadArtifactDemo('xps-analysis', 'XPS Analysis (Fe/O/C)', DEMO_XPS_ANALYSIS)
        }
        onLoadRamanDemo={() =>
          loadArtifactDemo('raman-id', 'Raman ID (calcite match)', DEMO_RAMAN_ID)
        }
        onLoadJobDemo={() =>
          loadArtifactDemo('job', 'DFT Job Monitor (CP2K BaTiO3)', DEMO_JOB_MONITOR)
        }
        onLoadComputeDemo={() =>
          loadArtifactDemo('compute', 'Compute: crystal analysis demo', DEMO_COMPUTE)
        }
        onLoadStructureDemo={() =>
          loadArtifactDemo(
            'structure',
            'BaTiO3 tetragonal',
            DEMO_STRUCTURE,
          )
        }
        onLoadResearchDemo={() =>
          loadArtifactDemo(
            'research-report',
            'Research Report (perovskite photocatalysis)',
            DEMO_RESEARCH_REPORT,
          )
        }
        onLoadBatchDemo={() =>
          loadArtifactDemo(
            'batch',
            'Batch Workflow (XRD series)',
            DEMO_BATCH_WORKFLOW,
          )
        }
        onLoadMaterialCompareDemo={() =>
          loadArtifactDemo(
            'material-comparison',
            'Material Comparison (6 perovskites)',
            DEMO_MATERIAL_COMPARISON,
          )
        }
        onLoadSimilarityDemo={() =>
          loadArtifactDemo(
            'similarity-matrix',
            'Similarity Matrix (6 XRD patterns)',
            DEMO_SIMILARITY_MATRIX,
          )
        }
        onLoadOptimizationDemo={() =>
          loadArtifactDemo(
            'optimization',
            'Optimization (Fe-doped BaTiO3 band gap)',
            DEMO_OPTIMIZATION,
          )
        }
        onLoadHypothesisDemo={() =>
          loadArtifactDemo(
            'hypothesis',
            'Hypothesis (Fe:BaTiO3 photocatalysis)',
            DEMO_HYPOTHESIS,
          )
        }
        onOpenLibrary={handleOpenLibrary}
        onLoadLatexDemo={loadLatexDemo}
        onExportSessionZip={handleExportSessionZip}
        onMockAgentStream={import.meta.env.DEV ? handleMockAgentStream : undefined}
        onRunAgent={handleRunAgent}
        onStartResearch={handleStartResearch}
        canRunDomainCommand={true}
        onOpenProWorkbench={openProWorkbench}
      />

      {libraryOpen && (
        <Suspense fallback={null}>
          <LibraryModal
            open={libraryOpen}
            onClose={() => setLibraryOpen(false)}
            data={DEMO_LIBRARY}
            onOpenPaper={handleOpenPaper}
          />
        </Suspense>
      )}

      {/* Phase B+ agent dialogs — singletons subscribed to agent-dialog-store.
          Rendering them here keeps the pending-approval / pending-question
          modals accessible from any view, not just when an agent is focused. */}
      <ApprovalDialog />
      <AskDialog />

      <div className="app-shell">
        <div className="app-shell-body">
          <ActivityBar
            sidebarVisible={layout.sidebarVisible}
            activeView={layout.activeView}
            onSelectView={selectSidebarView}
            onOpenLibraryWindow={handleOpenLibrary}
            onOpenWritingWindow={handleOpenWriting}
            onOpenCompute={() => openComputeOverlay()}
            computeOverlayOpen={computeOverlayOpen}
            onOpenSettings={handleOpenSettings}
          />

          {layout.sidebarVisible && (
            <>
              <div
                className="app-shell-sidebar app-shell-sidebar--draft"
                style={
                  {
                    '--sidebar-w': `${sidebarWidthDraft}px`,
                  } as React.CSSProperties
                }
              >
                <Sidebar
                  onOpenPaper={(paperId, meta, abs) =>
                    handleOpenPaper(paperId, meta, abs, 'floating')
                  }
                  onOpenLibraryWindow={handleOpenLibrary}
                  onLoadLatexDemo={loadLatexDemo}
                  onNewLatexDocument={newLatexDocument}
                  onLoadLatexTemplate={loadLatexTemplate}
                  onToggleSidebar={toggleSidebar}
                />
              </div>
              <Resizer
                orientation="vertical"
                value={sidebarWidthDraft}
                min={180}
                max={500}
                onDraft={(w) => {
                  sidebarWidthRef.current = w
                  setSidebarWidthDraft(w)
                }}
                onCommit={(w) => setLayout({ sidebarWidth: w })}
                resetTo={260}
                label="Resize sidebar"
              />
            </>
          )}

          <div
            className="workspace-main"
          >
            <WorkspaceTopbar
              sessionTitle={workspaceBreadcrumbLabel}
              surfaceTitle={workspaceSurfaceTitle}
              onOpenFile={openFile}
              onNewSession={handleNewSession}
              onOpenProLauncher={() => setProLauncherOpen(true)}
            />

            <div
              ref={workspaceMainBodyRef}
              className="workspace-main-body"
              style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}
            >
              {hasOpenFiles > 0 && (
                <>
                  <div
                    style={{
                      flex: '0 0 auto',
                      height: editorPaneHeight,
                      minHeight: EDITOR_PANE_HEIGHT_MIN,
                      overflow: 'hidden',
                    }}
                  >
                    <EditorArea />
                  </div>
                  <Resizer
                    orientation="horizontal"
                    value={editorPaneHeight}
                    min={EDITOR_PANE_HEIGHT_MIN}
                    max={editorPaneMax}
                    onDraft={(h) => {
                      editorPaneHeightRef.current = h
                      setEditorPaneHeightDraft(h)
                    }}
                    onCommit={(h) => setLayout({ editorPaneHeight: h })}
                    resetTo={WORKSPACE_EDITOR_PANE_RESET}
                    label="Resize editor pane"
                  />
                </>
              )}
              <div
                style={{
                  flex: 1,
                  minHeight: hasOpenFiles > 0 ? WORKSPACE_COMPOSER_PANE_MIN : 0,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <AgentComposer
                  onOpenLLMConfig={() => openSettingsTab('models')}
                  onStartResearch={handleStartResearch}
                  onClosePanel={toggleRightRail}
                />
              </div>
            </div>
          </div>

          {/* Right rail (Details/Inspector) removed per user request —
              the main workspace IS the chat; inspector content moves into
              AgentCard expand or dedicated panels if needed later. */}
          {false && layout.chatVisible && (
            <>
              <Resizer
                orientation="vertical"
                value={chatWidthDraft}
                min={260}
                max={520}
                invert
                onDraft={(w) => {
                  chatWidthRef.current = w
                  setChatWidthDraft(w)
                }}
                onCommit={(w) => setLayout({ chatWidth: w })}
                resetTo={320}
                label="Resize side panel"
              />
              <div
                className="app-shell-rail app-shell-rail--draft"
                style={
                  { '--rail-w': `${chatWidthDraft}px` } as React.CSSProperties
                }
              >
                <WorkspaceRail
                  activeTab={activeWorkspaceRailTab}
                  tabs={workspaceRailTabs}
                  onTabChange={setRightRailTab}
                  onClose={toggleRightRail}
                  onOpenLLMConfig={() => openSettingsTab('models')}
                  onStartResearch={handleStartResearch}
                />
              </div>
            </>
          )}
        </div>
        <StatusBar
          onExportSession={handleExportSession}
          onOpenLLMConfig={() => openSettingsTab('models')}
          usage={useStatusBarUsage()}
          context={useContextUsage()}
        />
      </div>

      {creatorOverlay && (
        <CreatorOverlay
          sessionId={creatorOverlay.sessionId}
          artifactId={creatorOverlay.artifactId}
          onClose={() => {
            const sid = creatorOverlay.sessionId
            setCreatorOverlay(null)
            const store = useRuntimeStore.getState()
            store.focusArtifact(sid, null)
          }}
        />
      )}

      {artifactOverlay && (
        <ArtifactOverlay
          sessionId={artifactOverlay.sessionId}
          artifactId={artifactOverlay.artifactId}
          onClose={() => setArtifactOverlay(null)}
        />
      )}

      {computeOverlayOpen && (
        <ComputeOverlay
          onClose={closeComputeOverlay}
          initialSpawn={computeSpawn}
          onSpawnConsumed={consumeComputeSpawn}
          focusCellId={computeFocusCellId}
          onFocusCellConsumed={consumeComputeFocusCell}
        />
      )}
    </>
  )
}

// Derive a lightweight usage snapshot from the usage + llm-config stores
// ── Creator full-screen overlay ─────────────────────────────────────
// Reads the focused latex artifact from the store and renders the card
// directly. Kept in App.tsx so the overlay state lives alongside the
// `openCreatorInline` callback.
function CreatorOverlay({
  sessionId,
  artifactId,
  onClose,
}: {
  sessionId: string
  artifactId: string
  onClose: () => void
}) {
  const artifact = useRuntimeStore(
    (s) => s.sessions[sessionId]?.artifacts[artifactId] ?? null,
  )
  useEscapeKey(onClose)
  if (!artifact || artifact.kind !== 'latex-document') {
    return (
      <div className="creator-overlay">
        <div className="creator-overlay-topbar">
          <span className="creator-overlay-title">Creator</span>
          <button
            type="button"
            className="creator-overlay-close"
            onClick={onClose}
            aria-label="Close Creator"
          >
            ×
          </button>
        </div>
        <div className="creator-overlay-loading">Artifact unavailable.</div>
      </div>
    )
  }
  return (
    <div className="creator-overlay">
      <div className="creator-overlay-topbar">
        <span className="creator-overlay-badge">Creator</span>
        <span className="creator-overlay-title">{artifact.title}</span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="creator-overlay-close"
          onClick={onClose}
          aria-label="Close Creator"
          title="Close (Esc)"
        >
          ×
        </button>
      </div>
      <div className="creator-overlay-body">
        <Suspense fallback={<div className="creator-overlay-loading">Loading Creator…</div>}>
          <LazyLatexDocumentCard
            artifact={artifact}
            sessionId={sessionId}
            variant="focus"
          />
        </Suspense>
      </div>
    </div>
  )
}

// ── Artifact full-screen overlay ────────────────────────────────────
// Minimal error boundary so a rendering crash inside a workbench doesn't
// white-screen the entire app. Also forwards the caught error to the
// structured log store so the console shows source='boundary' + stack.
class OverlayErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    log.exception(error, {
      source: 'boundary',
      type: 'runtime',
      detail: {
        componentStack: info.componentStack ?? undefined,
        location: 'artifact-overlay',
      },
    })
  }
  render() {
    if (this.state.error) {
      return (
        <div className="creator-overlay-loading" style={{ whiteSpace: 'pre-wrap', padding: 24 }}>
          <p style={{ color: '#e57373', marginBottom: 8 }}>Render error</p>
          <code style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
            {this.state.error.message}
          </code>
        </div>
      )
    }
    return this.props.children
  }
}

// Generic overlay for any artifact kind — renders the full artifact card
// (StructureArtifactCard with 3D viewer, ComputeArtifactCard with code
// editor, etc.) via the existing renderArtifactBody dispatcher.
function ArtifactOverlay({
  sessionId,
  artifactId,
  onClose,
}: {
  sessionId: string
  artifactId: string
  onClose: () => void
}) {
  const session = useRuntimeStore((s) => s.sessions[sessionId] ?? null)
  const artifact = session?.artifacts[artifactId] ?? null
  useEscapeKey(onClose)
  if (!artifact || !session) {
    return (
      <div className="creator-overlay">
        <div className="creator-overlay-topbar">
          <span className="creator-overlay-title">Artifact</span>
          <button
            type="button"
            className="creator-overlay-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="creator-overlay-loading">Artifact unavailable.</div>
      </div>
    )
  }
  return (
    <div className="creator-overlay">
      <div className="creator-overlay-topbar">
        <span className="creator-overlay-badge">
          {artifact.kind}
        </span>
        <span className="creator-overlay-title">{artifact.title}</span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="creator-overlay-close"
          onClick={onClose}
          aria-label="Close (Esc)"
          title="Close (Esc)"
        >
          ×
        </button>
      </div>
      <div className="creator-overlay-body">
        <OverlayErrorBoundary>
          {renderArtifactBody(artifact, session, { embed: 'full' })}
        </OverlayErrorBoundary>
      </div>
    </div>
  )
}

// ── Compute full-screen overlay ─────────────────────────────────────
// Opened from the activity bar. Resolves / auto-creates the session's
// compute-pro artifact, then renders the notebook-style ComputeNotebook.
// Esc closes; all state lives on the artifact so closing / reopening is
// lossless.
function ComputeOverlay({
  onClose,
  initialSpawn,
  onSpawnConsumed,
  focusCellId,
  onFocusCellConsumed,
}: {
  onClose: () => void
  initialSpawn: OpenComputeOverlayRequest['spawnCell'] | null
  onSpawnConsumed: () => void
  focusCellId: string | null
  onFocusCellConsumed: () => void
}) {
  const activeSessionId = useRuntimeStore((s) => s.activeSessionId)
  const artifact = useRuntimeStore((s) => {
    if (!s.activeSessionId) return null
    const session = s.sessions[s.activeSessionId]
    if (!session) return null
    for (const id of session.artifactOrder) {
      const a = session.artifacts[id]
      if (a && a.kind === 'compute-pro') return a
    }
    return null
  })

  // Auto-create the compute-pro artifact on first open so the overlay is
  // immediately usable — same semantics as the old sidebar path.
  useEffect(() => {
    if (!activeSessionId) return
    if (artifact) return
    createProWorkbench({
      sessionId: activeSessionId,
      kind: 'compute-pro',
      spectrum: null,
    })
  }, [activeSessionId, artifact])

  useEscapeKey(onClose)

  return (
    <div className="creator-overlay">
      <div className="creator-overlay-topbar">
        <span className="creator-overlay-badge">Compute</span>
        <span className="creator-overlay-title">
          {activeSessionId ? 'Workbench' : 'No active session'}
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="creator-overlay-close"
          onClick={onClose}
          aria-label="Close Compute"
          title="Close (Esc)"
        >
          ×
        </button>
      </div>
      <div className="creator-overlay-body">
        {activeSessionId && artifact ? (
          <Suspense
            fallback={
              <div className="creator-overlay-loading">
                Loading Compute…
              </div>
            }
          >
            <LazyComputeNotebook
              sessionId={activeSessionId}
              artifact={artifact}
              initialSpawn={initialSpawn}
              onSpawnConsumed={onSpawnConsumed}
              initialFocusCellId={focusCellId}
              onFocusCellConsumed={onFocusCellConsumed}
            />
          </Suspense>
        ) : (
          <div className="creator-overlay-loading">
            {activeSessionId ? 'Opening workbench…' : 'Create a session first.'}
          </div>
        )}
      </div>
    </div>
  )
}

// for the StatusBar chip. Re-computes whenever records / budget change.
function useStatusBarUsage() {
  const records = useUsageStore((s) => s.records)
  const getTodayTotals = useUsageStore((s) => s.getTodayTotals)
  const budget = useLLMConfigStore((s) => s.budget)
  return useMemo(() => {
    const today = getTodayTotals()
    const total = today.inputTokens + today.outputTokens
    const tokenPct = budget.daily.tokenLimit
      ? total / budget.daily.tokenLimit
      : 0
    const costPct = budget.daily.costLimitUSD
      ? today.costUSD / budget.daily.costLimitUSD
      : 0
    const pct = Math.max(tokenPct, costPct)
    return {
      tokens: total,
      costUSD: today.costUSD,
      pct,
      warn: pct >= budget.warnAtPct,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, budget, getTodayTotals])
}

// Derive a context-window snapshot for the active session. We don't maintain
// a live token count inside Lattice — instead we read the `inputTokens` the
// provider reported on the most recent successful call for this session,
// since every call resends the full history. Returns `null` when there is
// no active session or no prior call (chip hides itself).
function useContextUsage(): ContextSnapshot | null {
  const records = useUsageStore((s) => s.records)
  const session = useRuntimeStore(selectActiveSession)
  const resolved = useResolvedModel('agent')
  return useMemo(() => {
    if (!session || !resolved?.model) return null
    const contextWindow = resolved.model.contextWindow
    if (!contextWindow || contextWindow <= 0) return null
    const last = findLastSessionInputTokens(records, session.id)
    if (last === null) return null
    const state = calculateTokenWarningState(last, contextWindow)
    return {
      inputTokens: last,
      threshold: state.threshold,
      percentUsed: state.percentUsed,
      level: state.level,
    }
  }, [records, session?.id, resolved?.model])
}

function findLastSessionInputTokens(
  records: ReadonlyArray<{
    sessionId: string | null
    success: boolean
    inputTokens: number
  }>,
  sessionId: string,
): number | null {
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i]
    if (r.sessionId !== sessionId) continue
    if (!r.success) continue
    if (!Number.isFinite(r.inputTokens) || r.inputTokens <= 0) continue
    return r.inputTokens
  }
  return null
}
