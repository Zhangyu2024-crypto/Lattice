import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import '../../../../styles/latex-creator.css'
import { Loader2, Play } from 'lucide-react'
import { useSessionStore } from '../../../../stores/session-store'
import type { Artifact } from '../../../../types/artifact'
import type {
  LatexCompileError,
  LatexCompileStatus,
  LatexDocumentPayload,
  LatexFile,
} from '../../../../types/latex'
import type { LatexCollaborationRuntimeState } from '../../../../types/collaboration'
import { toast } from '../../../../stores/toast-store'
import { Button } from '../../../ui'
import LatexCodeMirror from './LatexCodeMirror'
import LatexPreviewPane from './LatexPreviewPane'
import LatexErrorsPane from './LatexErrorsPane'
import LatexDetailsPane from './LatexDetailsPane'
import LatexAgentChat from './LatexAgentChat'
import {
  latexSelectionMenu,
  type SelectionMenuCommandCtx,
} from './LatexSelectionMenu'
import { getBusytexRunner } from '../../../../lib/latex/busytex-runner'
import { parseLatexLog } from '../../../../lib/latex/log-parser'
import { errorMessage } from '../../../../lib/error-message'
import { asyncPrompt } from '../../../../lib/prompt-dialog'
import { CompileBadge } from './document-card/CompileBadge'
import { LatexFileTabs } from './document-card/LatexFileTabs'
import { FocusDrawer } from './document-card/FocusDrawer'
import { FocusHeaderActions } from './document-card/FocusHeaderActions'
import { AiPalette } from './document-card/AiPalette'
import { CardRightPane } from './document-card/CardRightPane'
import { runSelectionCommand } from './document-card/run-selection-command'
import { useFocusShortcuts } from './document-card/use-focus-shortcuts'
import { useDrawerResize } from './document-card/use-drawer-resize'
import { normalizeLatexCollaborationMetadata } from '../../../../lib/latex/collaboration'
import { useLatexCollaboration } from './useLatexCollaboration'

interface Props {
  artifact: Artifact
  sessionId: string
  /** 'card' (default) — legacy split layout used inside the canvas / artifact
   *  editor. 'focus' — immersive Creator overlay: full-bleed editor, right
   *  slide-in drawer for Preview/Errors/Details, AI moved to a centered
   *  command palette behind Ctrl+K. */
  variant?: 'card' | 'focus'
}

type RightTab = 'preview' | 'errors' | 'details'

const AUTO_COMPILE_DEBOUNCE_MS = 2000

export default function LatexDocumentCard({
  artifact,
  sessionId,
  variant = 'card',
}: Props) {
  const payload = artifact.payload as unknown as LatexDocumentPayload
  const patchArtifact = useSessionStore((s) => s.patchArtifact)
  const [collaborationRuntime, setCollaborationRuntime] =
    useState<LatexCollaborationRuntimeState>({
      status: 'disabled',
      members: [],
    })

  const [files, setFiles] = useState<LatexFile[]>(payload.files)
  const [activeFile, setActiveFile] = useState<string>(
    payload.activeFile ||
      payload.files.find((f) => f.path === payload.rootFile)?.path ||
      payload.files[0]?.path ||
      'main.tex',
  )
  // PDF bytes are intentionally kept only in component state — they're
  // expensive and easy to regenerate. See session-store's
  // pruneArtifactForPersist: `latex-document` persists logTail (16KB) but
  // never pdf/pdf-cache fields.
  const [pdf, setPdf] = useState<Uint8Array | null>(null)
  const [rightTab, setRightTab] = useState<RightTab>('preview')
  // Focus-mode only: right slide-in drawer and centered AI palette. The
  // drawer opens to Preview by default so the PDF surface is discoverable
  // (pure-blank editor hides where the output goes); the user can close it
  // for a fullscreen writing session and keep it closed. The AI palette
  // stays closed until Ctrl+K — it's explicitly a command-palette affordance.
  const [drawerTab, setDrawerTab] = useState<RightTab | null>(
    variant === 'focus' ? 'preview' : null,
  )
  const [aiOpen, setAiOpen] = useState(false)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const {
    drawerWidth,
    onSplitterPointerDown,
    onSplitterPointerMove,
    onSplitterPointerUp,
    onSplitterDoubleClick,
  } = useDrawerResize(bodyRef)
  const [compilingSince, setCompilingSince] = useState<number | null>(null)
  // Snapshot of the compile output + parsed errors. Mirrors the payload's
  // status / errors fields but driven from the most recent compile — so
  // user reloads don't flash stale error lists while we wait for the first
  // re-compile.
  const [compileSnapshot, setCompileSnapshot] = useState<{
    status: LatexCompileStatus
    errors: LatexCompileError[]
    warnings: LatexCompileError[]
    logTail: string
  }>({
    status: payload.status,
    errors: payload.errors,
    warnings: payload.warnings,
    logTail: payload.logTail,
  })

  const active = useMemo(
    () => files.find((f) => f.path === activeFile) ?? files[0],
    [files, activeFile],
  )
  const normalizedCollaboration = useMemo(
    () =>
      normalizeLatexCollaborationMetadata(
        payload,
        artifact.id,
        artifact.title,
      ),
    [payload.collaboration, artifact.id, artifact.title],
  )

  const filesRef = useRef(files)
  filesRef.current = files
  const payloadRef = useRef(payload)
  payloadRef.current = payload
  const aiInFlightRef = useRef(false)
  const [aiBusy, setAiBusy] = useState(false)
  // Bumped whenever a file is overwritten from outside CodeMirror (AI
  // "Apply" button). LatexCodeMirror only reads `value` on mount, so we
  // force a remount of the active file's view when its content is
  // replaced wholesale — losing its undo stack is the correct semantics
  // for a confirmed AI replacement.
  const [applyVersion, setApplyVersion] = useState(0)
  const applyVersionBumpRef = useRef<string | null>(null)
  const handlePatchPayload = useCallback(
    (partial: Partial<LatexDocumentPayload>) => {
      const cur = payloadRef.current
      patchArtifact(sessionId, artifact.id, {
        payload: {
          ...cur,
          files: filesRef.current,
          activeFile,
          ...partial,
        },
      } as never)
    },
    [patchArtifact, sessionId, artifact.id, activeFile],
  )

  const flushFiles = useCallback(
    (nextFiles: LatexFile[], nextActive: string) => {
      const current = payloadRef.current
      const sameFiles = JSON.stringify(nextFiles) === JSON.stringify(current.files)
      const sameActive = nextActive === current.activeFile
      if (sameFiles && sameActive) return
      patchArtifact(sessionId, artifact.id, {
        payload: {
          ...current,
          files: nextFiles,
          activeFile: nextActive,
        },
      } as never)
    },
    [patchArtifact, sessionId, artifact.id],
  )

  const handleEdit = useCallback(
    (next: string) => {
      setFiles((cur) =>
        cur.map((f) => (f.path === activeFile ? { ...f, content: next } : f)),
      )
    },
    [activeFile],
  )

  const handleRemoteEdit = useCallback(
    (next: string) => {
      const current = filesRef.current.find((f) => f.path === activeFile)
      if (current?.content === next) return
      const nextFiles = filesRef.current.map((f) =>
        f.path === activeFile ? { ...f, content: next } : f,
      )
      setFiles(nextFiles)
      flushFiles(nextFiles, activeFile)
    },
    [activeFile, flushFiles],
  )

  const {
    extension: collaborationExtension,
    editorValue: collaborationEditorValue,
    runtime: liveCollaborationRuntime,
  } = useLatexCollaboration({
    collaboration: normalizedCollaboration,
    filePath: active?.path ?? activeFile,
    initialText: active?.content ?? '',
    onRemoteText: handleRemoteEdit,
  })

  useEffect(() => {
    setCollaborationRuntime(liveCollaborationRuntime)
  }, [liveCollaborationRuntime])

  // Capture `handleSelectionCommand` in a ref so the CM6 extension (created
  // once via useMemo) always calls the latest closure — avoids rebuilding
  // the editor view on every state change just to refresh the handler.
  const handleSelectionCommandRef = useRef<
    (ctx: SelectionMenuCommandCtx) => void
  >(() => {})
  const selectionMenuExtension = useMemo(
    () =>
      latexSelectionMenu({
        onCommand: (ctx) => handleSelectionCommandRef.current(ctx),
        disabled: () => aiInFlightRef.current,
      }),
    [],
  )
  const editorExtensions = useMemo(
    () =>
      collaborationExtension
        ? [selectionMenuExtension, collaborationExtension]
        : [selectionMenuExtension],
    [selectionMenuExtension, collaborationExtension],
  )
  handleSelectionCommandRef.current = async (
    ctx: SelectionMenuCommandCtx,
  ) => {
    if (aiInFlightRef.current) {
      toast.warn('AI command already running')
      return
    }
    aiInFlightRef.current = true
    setAiBusy(true)
    try {
      await runSelectionCommand({
        ctx,
        payload: payloadRef.current,
        sessionId,
      })
    } finally {
      aiInFlightRef.current = false
      setAiBusy(false)
    }
  }

  const handleSwitchFile = (path: string) => {
    if (path === activeFile) return
    flushFiles(filesRef.current, path)
    setActiveFile(path)
  }

  const handleBlur = () => flushFiles(filesRef.current, activeFile)

  const handleNewFile = async () => {
    const raw = await asyncPrompt('New file path (e.g. chapters/methods.tex):')
    if (!raw) return
    const path = raw.trim()
    if (!path) return
    if (filesRef.current.some((f) => f.path === path)) {
      toast.warn(`File "${path}" already exists`)
      return
    }
    const ext = path.split('.').pop()?.toLowerCase() ?? ''
    const kind: LatexFile['kind'] =
      ext === 'bib' ? 'bib' : ext === 'tex' ? 'tex' : 'asset'
    const next = [...filesRef.current, { path, kind, content: '' }]
    setFiles(next)
    flushFiles(next, path)
    setActiveFile(path)
  }

  /** Replace the full contents of one file (used by the AI assistant
   *  "Apply" button) and persist the update to the artifact store. */
  const applyFileContents = useCallback(
    (path: string, content: string) => {
      const current = filesRef.current
      if (!current.some((f) => f.path === path)) {
        toast.warn(`File "${path}" is not in the project.`)
        return
      }
      const next = current.map((f) =>
        f.path === path ? { ...f, content } : f,
      )
      setFiles(next)
      // If we just overwrote the file the editor is currently showing,
      // bump the remount counter so CodeMirror picks up the new doc.
      if (path === activeFile) {
        applyVersionBumpRef.current = path
        setApplyVersion((v) => v + 1)
      } else {
        // Jump to the file we just changed so the user can see the new
        // contents immediately; also remount to load them.
        setActiveFile(path)
        applyVersionBumpRef.current = path
        setApplyVersion((v) => v + 1)
      }
      flushFiles(next, path)
    },
    [flushFiles, activeFile],
  )

  const handleCloseFile = (path: string) => {
    if (filesRef.current.length <= 1) {
      toast.warn('A LaTeX project must contain at least one file')
      return
    }
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Remove "${path}" from the project?`)) return
    const next = filesRef.current.filter((f) => f.path !== path)
    const nextActive = path === activeFile ? next[0].path : activeFile
    setFiles(next)
    flushFiles(next, nextActive)
    setActiveFile(nextActive)
  }

  const compileInFlightRef = useRef(false)
  const compile = useCallback(async () => {
    if (compileInFlightRef.current) {
      toast.warn('Compile already in progress')
      return
    }
    const current = payloadRef.current
    const snapshot = filesRef.current
    compileInFlightRef.current = true
    setCompilingSince(Date.now())
    setCompileSnapshot((s) => ({ ...s, status: 'compiling' }))
    patchArtifact(sessionId, artifact.id, {
      payload: {
        ...current,
        files: snapshot,
        activeFile,
        status: 'compiling' as const,
      },
    } as never)

    try {
      const runner = await getBusytexRunner()
      const result = await runner.compile({
        files: snapshot.map((f) => ({ path: f.path, contents: f.content })),
        rootFile: current.rootFile,
      })
      const parsed = parseLatexLog(result.log)
      const logTail = result.log.slice(-64 * 1024)
      setPdf(result.pdf)
      setCompileSnapshot({
        status: result.ok ? 'succeeded' : 'failed',
        errors: parsed.errors,
        warnings: parsed.warnings,
        logTail,
      })
      if (!result.ok && parsed.errors.length > 0) {
        setRightTab('errors')
        // Focus mode: if the user has the drawer closed, surface the
        // errors automatically. If they're reading preview / details we
        // respect that and don't yank the tab out from under them.
        setDrawerTab((t) => (t === null ? 'errors' : t))
      } else if (result.ok) {
        setRightTab('preview')
        setDrawerTab((t) => (t === null ? 'preview' : t))
      }
      // Persist the compile result (minus the PDF, which is never persisted).
      patchArtifact(sessionId, artifact.id, {
        payload: {
          ...payloadRef.current,
          files: snapshot,
          activeFile,
          status: result.ok ? 'succeeded' : 'failed',
          lastCompileAt: Date.now(),
          durationMs: result.durationMs,
          errors: parsed.errors,
          warnings: parsed.warnings,
          logTail,
        },
      } as never)
    } catch (err) {
      const msg = errorMessage(err)
      toast.error(`Compile failed: ${msg}`)
      setCompileSnapshot({
        status: 'failed',
        errors: [
          { file: null, line: null, severity: 'error', message: msg },
        ],
        warnings: [],
        logTail: msg,
      })
      setRightTab('errors')
      setDrawerTab((t) => (t === null ? 'errors' : t))
      patchArtifact(sessionId, artifact.id, {
        payload: {
          ...payloadRef.current,
          status: 'failed' as const,
          errors: [
            { file: null, line: null, severity: 'error', message: msg },
          ],
          warnings: [],
          logTail: msg,
        },
      } as never)
    } finally {
      compileInFlightRef.current = false
      setCompilingSince(null)
    }
  }, [patchArtifact, sessionId, artifact.id, activeFile])

  // Auto-compile: 2s after the last edit, if payload.autoCompile is on.
  const autoCompileTimer = useRef<number | null>(null)
  useEffect(() => {
    if (!payloadRef.current.autoCompile) return
    if (autoCompileTimer.current != null) {
      window.clearTimeout(autoCompileTimer.current)
    }
    autoCompileTimer.current = window.setTimeout(() => {
      autoCompileTimer.current = null
      void compile()
    }, AUTO_COMPILE_DEBOUNCE_MS)
    return () => {
      if (autoCompileTimer.current != null) {
        window.clearTimeout(autoCompileTimer.current)
        autoCompileTimer.current = null
      }
    }
  }, [files, compile])

  useFocusShortcuts({
    enabled: variant === 'focus',
    aiOpen,
    setAiOpen,
    drawerTab,
    setDrawerTab,
    compile,
  })

  const issueCount =
    compileSnapshot.errors.length + compileSnapshot.warnings.length

  if (variant === 'focus') {
    return (
      <div className="latex-focus-root">
        <header className="latex-focus-header">
          <LatexFileTabs
            variant="focus"
            files={files}
            activeFile={activeFile}
            rootFile={payload.rootFile}
            onSwitchFile={handleSwitchFile}
            onCloseFile={handleCloseFile}
            onNewFile={handleNewFile}
          />
          <FocusHeaderActions
            status={compileSnapshot.status}
            drawerTab={drawerTab}
            setDrawerTab={setDrawerTab}
            aiOpen={aiOpen}
            setAiOpen={setAiOpen}
            issueCount={issueCount}
            compilingSince={compilingSince}
            onCompile={() => void compile()}
          />
        </header>

        <div className="latex-focus-body" ref={bodyRef}>
          <div className="latex-focus-editor" onBlur={handleBlur}>
            {active ? (
              <LatexCodeMirror
                key={
                  applyVersionBumpRef.current === active.path
                    ? `${active.path}::${applyVersion}`
                    : active.path
                }
                value={collaborationEditorValue ?? active.content}
                onChange={handleEdit}
                extraExtensions={editorExtensions}
              />
            ) : null}
          </div>

          {drawerTab !== null ? (
            <FocusDrawer
              drawerTab={drawerTab}
              setDrawerTab={setDrawerTab}
              drawerWidth={drawerWidth}
              issueCount={issueCount}
              onSplitterPointerDown={onSplitterPointerDown}
              onSplitterPointerMove={onSplitterPointerMove}
              onSplitterPointerUp={onSplitterPointerUp}
              onSplitterDoubleClick={onSplitterDoubleClick}
            >
              {drawerTab === 'preview' ? (
                <LatexPreviewPane
                  pdf={pdf}
                  status={compileSnapshot.status}
                  errorCount={compileSnapshot.errors.length}
                  artifactKey={artifact.id}
                  logTail={compileSnapshot.logTail}
                />
              ) : drawerTab === 'errors' ? (
                <LatexErrorsPane
                  errors={compileSnapshot.errors}
                  warnings={compileSnapshot.warnings}
                  logTail={compileSnapshot.logTail}
                />
              ) : (
                <LatexDetailsPane
                  documentTitle={artifact.title}
                  artifactId={artifact.id}
                  payload={payload}
                  collaboration={normalizedCollaboration}
                  collaborationRuntime={collaborationRuntime}
                  onPatchPayload={handlePatchPayload}
                />
              )}
            </FocusDrawer>
          ) : null}
        </div>

        {aiOpen ? (
          <AiPalette onClose={() => setAiOpen(false)}>
            <LatexAgentChat
              files={files}
              activeFile={activeFile}
              payload={payload}
              errors={compileSnapshot.errors}
              warnings={compileSnapshot.warnings}
              sessionId={sessionId}
              onApplyFile={applyFileContents}
            />
          </AiPalette>
        ) : null}
      </div>
    )
  }

  return (
    <div className="latex-card-root">
      <header className="latex-card-header">
        <LatexFileTabs
          variant="card"
          files={files}
          activeFile={activeFile}
          rootFile={payload.rootFile}
          onSwitchFile={handleSwitchFile}
          onCloseFile={handleCloseFile}
          onNewFile={handleNewFile}
        />
        <div className="latex-card-actions">
          <CompileBadge status={compileSnapshot.status} />
          <Button
            variant="primary"
            size="sm"
            className="latex-card-compile-btn"
            onClick={() => void compile()}
            disabled={compilingSince != null}
            leading={
              compilingSince != null ? (
                <Loader2 size={12} className="spin" />
              ) : (
                <Play size={12} />
              )
            }
            title="Compile this project with BusyTeX (pdfTeX / bibtex8)"
          >
            {compilingSince != null ? 'Compiling…' : 'Compile'}
          </Button>
        </div>
      </header>

      <div className="latex-card-split">
        <div className="latex-card-editor" onBlur={handleBlur}>
          {active ? (
            <LatexCodeMirror
              key={
                applyVersionBumpRef.current === active.path
                  ? `${active.path}::${applyVersion}`
                  : active.path
              }
              value={collaborationEditorValue ?? active.content}
              onChange={handleEdit}
              extraExtensions={editorExtensions}
            />
          ) : null}
        </div>
        <div className="latex-card-splitter" />
        <CardRightPane
          rightTab={rightTab}
          setRightTab={setRightTab}
          issueCount={issueCount}
        >
          {rightTab === 'preview' ? (
            <LatexPreviewPane
              pdf={pdf}
              status={compileSnapshot.status}
              errorCount={compileSnapshot.errors.length}
              artifactKey={artifact.id}
              logTail={compileSnapshot.logTail}
            />
          ) : rightTab === 'errors' ? (
            <LatexErrorsPane
              errors={compileSnapshot.errors}
              warnings={compileSnapshot.warnings}
              logTail={compileSnapshot.logTail}
            />
          ) : (
            <LatexDetailsPane
              documentTitle={artifact.title}
              artifactId={artifact.id}
              payload={payload}
              collaboration={normalizedCollaboration}
              collaborationRuntime={collaborationRuntime}
              onPatchPayload={handlePatchPayload}
            />
          )}
        </CardRightPane>
      </div>

      <LatexAgentChat
        files={files}
        activeFile={activeFile}
        payload={payload}
        errors={compileSnapshot.errors}
        warnings={compileSnapshot.warnings}
        sessionId={sessionId}
        onApplyFile={applyFileContents}
      />
    </div>
  )
}
