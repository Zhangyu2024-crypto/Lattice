import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import '../../../../styles/latex-creator.css'
import { FileCode2, Loader2, Play } from 'lucide-react'
import { useSessionStore } from '../../../../stores/session-store'
import type { Artifact } from '../../../../types/artifact'
import type {
  LatexCompileError,
  LatexCompileStatus,
  LatexDocumentPayload,
  LatexDocumentVersion,
  LatexFile,
  LatexVersionReason,
} from '../../../../types/latex'
import type { LatexCollaborationRuntimeState } from '../../../../types/collaboration'
import { toast } from '../../../../stores/toast-store'
import { useWorkspaceStore } from '../../../../stores/workspace-store'
import { Button } from '../../../ui'
import LatexCodeMirror from './LatexCodeMirror'
import LatexPreviewPane from './LatexPreviewPane'
import LatexErrorsPane from './LatexErrorsPane'
import LatexDetailsPane from './LatexDetailsPane'
import LatexVersionsPane from './LatexVersionsPane'
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
import { CardRightPane } from './document-card/CardRightPane'
import { runSelectionCommand } from './document-card/run-selection-command'
import { useFocusShortcuts } from './document-card/use-focus-shortcuts'
import { useDrawerResize } from './document-card/use-drawer-resize'
import { ProjectRail } from './document-card/ProjectRail'
import {
  LATEX_CREATOR_WORKSPACE_DIR,
  ensureLatexExtension,
  kindFromLatexPath,
  normalizeLatexProjectFiles,
  normalizeLatexProjectPath,
} from '../../../../lib/latex/project-paths'
import {
  INITIAL_LATEX_WORKSPACE_SYNC,
  syncLatexFilesToWorkspace,
  type LatexWorkspaceSyncState,
} from '../../../../lib/latex/workspace-sync'
import {
  appendLatexVersion,
  createLatexVersion,
  defaultLatexVersionLabel,
  restoreLatexVersionPayload,
} from '../../../../lib/latex/versions'
import { normalizeLatexCollaborationMetadata } from '../../../../lib/latex/collaboration'
import { useLatexCollaboration } from './useLatexCollaboration'

interface Props {
  artifact: Artifact
  sessionId: string
  /** 'card' (default) — legacy split layout used inside the canvas / artifact
   *  editor. 'focus' — immersive Creator workbench: project rail, source
   *  editor, and compile / AI panels in a right drawer. */
  variant?: 'card' | 'focus'
}

type RightTab = 'preview' | 'errors' | 'versions' | 'details'
type FocusRightTab = RightTab | 'ai'

const AUTO_COMPILE_DEBOUNCE_MS = 2000
const WORKSPACE_SYNC_DEBOUNCE_MS = 800
const FIX_WITH_AI_PROMPT =
  'Fix every compile error and warning listed in COMPILE DIAGNOSTICS. Only change what is needed. Return the full corrected contents of any file you modify.'

function defaultProjectFile(files: LatexFile[]): string {
  return (
    files.find((f) => f.kind === 'tex')?.path ??
    files[0]?.path ??
    'main.tex'
  )
}

function resolveProjectFile(
  files: LatexFile[],
  requested: string | undefined,
  fallback = defaultProjectFile(files),
): string {
  const normalized = normalizeLatexProjectPath(requested ?? '')
  return normalized && files.some((f) => f.path === normalized)
    ? normalized
    : fallback
}

export default function LatexDocumentCard({
  artifact,
  sessionId,
  variant = 'card',
}: Props) {
  const payload = artifact.payload as unknown as LatexDocumentPayload
  const workspaceRootPath = useWorkspaceStore((s) => s.rootPath)
  const workspaceHydrated = useWorkspaceStore((s) => s.hydrated)
  const hydrateWorkspace = useWorkspaceStore((s) => s.hydrate)
  const refreshWorkspaceDir = useWorkspaceStore((s) => s.refreshDir)
  const workspaceFs = useWorkspaceStore((s) => s.getFs())
  const normalizedInitialFiles = useMemo(
    () => normalizeLatexProjectFiles(payload.files),
    [payload.files],
  )
  const initialRootFile = resolveProjectFile(
    normalizedInitialFiles,
    payload.rootFile,
  )
  const initialActiveFile = resolveProjectFile(
    normalizedInitialFiles,
    payload.activeFile,
    initialRootFile,
  )
  const patchArtifact = useSessionStore((s) => s.patchArtifact)
  const [collaborationRuntime, setCollaborationRuntime] =
    useState<LatexCollaborationRuntimeState>({
      status: 'disabled',
      members: [],
    })

  const [files, setFiles] = useState<LatexFile[]>(normalizedInitialFiles)
  const [activeFile, setActiveFile] = useState<string>(initialActiveFile)
  const rootFile = resolveProjectFile(files, payload.rootFile)
  const normalizedPayload = useMemo<LatexDocumentPayload>(
    () => ({
      ...payload,
      files,
      rootFile,
      activeFile: resolveProjectFile(files, activeFile, rootFile),
    }),
    [payload, files, rootFile, activeFile],
  )
  // PDF bytes are intentionally kept only in component state — they're
  // expensive and easy to regenerate. See session-store's
  // pruneArtifactForPersist: `latex-document` persists logTail (16KB) but
  // never pdf/pdf-cache fields.
  const [pdf, setPdf] = useState<Uint8Array | null>(null)
  const [rightTab, setRightTab] = useState<RightTab>('preview')
  // Focus-mode only: right drawer for compile output, diagnostics, AI, and
  // project details. Preview is the default so the PDF surface is
  // discoverable; Ctrl+K switches this drawer to AI.
  const [drawerTab, setDrawerTab] = useState<FocusRightTab | null>(
    variant === 'focus' ? 'preview' : null,
  )
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const {
    drawerWidth,
    onSplitterPointerDown,
    onSplitterPointerMove,
    onSplitterPointerUp,
    onSplitterDoubleClick,
  } = useDrawerResize(bodyRef)
  const [compilingSince, setCompilingSince] = useState<number | null>(null)
  const [workspaceSync, setWorkspaceSync] = useState<LatexWorkspaceSyncState>(
    INITIAL_LATEX_WORKSPACE_SYNC,
  )
  const [aiAutoPrompt, setAiAutoPrompt] = useState<string | null>(null)
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
  const [sourceJump, setSourceJump] = useState<{
    path: string
    line: number
    seq: number
  } | null>(null)

  useEffect(() => {
    if (workspaceHydrated) return
    void hydrateWorkspace()
  }, [workspaceHydrated, hydrateWorkspace])

  const syncWorkspaceNow = useCallback(
    async (opts: { showToast?: boolean } = {}) => {
      if (!workspaceRootPath) {
        setWorkspaceSync({
          status: 'no-workspace',
          savedAt: null,
          error: 'Open a workspace folder first.',
        })
        if (opts.showToast) {
          toast.warn('Open a workspace folder before syncing Creator files.')
        }
        return
      }
      try {
        setWorkspaceSync((s) => ({ ...s, status: 'syncing', error: null }))
        const written = await syncLatexFilesToWorkspace(
          workspaceFs,
          filesRef.current,
        )
        await refreshWorkspaceDir('')
        await refreshWorkspaceDir(LATEX_CREATOR_WORKSPACE_DIR)
        setWorkspaceSync({
          status: 'synced',
          savedAt: Date.now(),
          error: null,
        })
        if (opts.showToast) {
          toast.success(
            `Synced ${written} Creator file${written === 1 ? '' : 's'}`,
          )
        }
      } catch (err) {
        const message = errorMessage(err)
        setWorkspaceSync({
          status: 'error',
          savedAt: null,
          error: message,
        })
        if (opts.showToast) toast.error(`Creator sync failed: ${message}`)
      }
    },
    [workspaceRootPath, workspaceFs, refreshWorkspaceDir],
  )

  useEffect(() => {
    if (!workspaceHydrated) return
    if (!workspaceRootPath) {
      setWorkspaceSync({
        status: 'no-workspace',
        savedAt: null,
        error: 'Open a workspace folder first.',
      })
      return
    }
    setWorkspaceSync((s) =>
      s.status === 'synced'
        ? { ...s, status: 'idle', error: null }
        : s.status === 'syncing'
          ? s
          : { ...s, status: 'idle', error: null },
    )
    const timer = window.setTimeout(() => {
      void syncWorkspaceNow()
    }, WORKSPACE_SYNC_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [files, workspaceHydrated, workspaceRootPath, syncWorkspaceNow])

  const handleManualWorkspaceSync = useCallback(() => {
    void syncWorkspaceNow({ showToast: true })
  }, [syncWorkspaceNow])

  const handleFixWithAi = useCallback(() => {
    setDrawerTab('ai')
    setAiAutoPrompt(FIX_WITH_AI_PROMPT)
  }, [])

  const handlePatchPayload = useCallback(
    (partial: Partial<LatexDocumentPayload>) => {
      const cur = payloadRef.current
      const nextFiles = normalizeLatexProjectFiles(
        partial.files ?? filesRef.current,
      )
      const nextRoot = resolveProjectFile(
        nextFiles,
        partial.rootFile ?? cur.rootFile,
      )
      const nextActive = resolveProjectFile(
        nextFiles,
        partial.activeFile ?? activeFile,
        nextRoot,
      )
      patchArtifact(sessionId, artifact.id, {
        payload: {
          ...cur,
          ...partial,
          files: nextFiles,
          activeFile: nextActive,
          rootFile: nextRoot,
        },
      } as never)
    },
    [patchArtifact, sessionId, artifact.id, activeFile],
  )

  const flushFiles = useCallback(
    (nextFiles: LatexFile[], nextActive: string) => {
      const current = payloadRef.current
      const normalizedFiles = normalizeLatexProjectFiles(nextFiles)
      const nextRoot = resolveProjectFile(normalizedFiles, current.rootFile)
      const normalizedActive = resolveProjectFile(
        normalizedFiles,
        nextActive,
        nextRoot,
      )
      const sameFiles =
        JSON.stringify(normalizedFiles) === JSON.stringify(current.files)
      const sameActive = normalizedActive === current.activeFile
      if (sameFiles && sameActive && nextRoot === current.rootFile) return
      patchArtifact(sessionId, artifact.id, {
        payload: {
          ...current,
          files: normalizedFiles,
          activeFile: normalizedActive,
          rootFile: nextRoot,
        },
      } as never)
    },
    [patchArtifact, sessionId, artifact.id],
  )

  const saveVersion = useCallback(
    (label: string, reason: LatexVersionReason): LatexDocumentVersion => {
      const current = payloadRef.current
      const snapshot = normalizeLatexProjectFiles(filesRef.current)
      const version = createLatexVersion({
        files: snapshot,
        rootFile: current.rootFile,
        activeFile,
        label,
        reason,
      })
      patchArtifact(sessionId, artifact.id, {
        payload: {
          ...current,
          files: snapshot,
          activeFile,
          versions: appendLatexVersion(current.versions, version),
        },
      } as never)
      return version
    },
    [activeFile, artifact.id, patchArtifact, sessionId],
  )

  const handleCreateManualVersion = useCallback(async () => {
    const label = await asyncPrompt({
      message: 'Version label',
      placeholder: defaultLatexVersionLabel('manual'),
      defaultValue: defaultLatexVersionLabel('manual'),
      okLabel: 'Save',
    })
    if (label == null) return
    saveVersion(label, 'manual')
    toast.success('LaTeX version saved')
    setDrawerTab('versions')
    setRightTab('versions')
  }, [saveVersion])

  const handleRestoreVersion = useCallback(
    (version: LatexDocumentVersion) => {
      // eslint-disable-next-line no-alert
      if (!window.confirm(`Restore "${version.label}"? Current files will be replaced.`)) {
        return
      }
      const current = payloadRef.current
      const before = createLatexVersion({
        files: filesRef.current,
        rootFile: current.rootFile,
        activeFile,
        label: `Before restoring ${version.label}`,
        reason: 'restore',
      })
      const restored = restoreLatexVersionPayload(current, version)
      const versions = appendLatexVersion(current.versions, before)
      setFiles(restored.files)
      filesRef.current = restored.files
      setActiveFile(restored.activeFile)
      applyVersionBumpRef.current = restored.activeFile
      setApplyVersion((v) => v + 1)
      patchArtifact(sessionId, artifact.id, {
        payload: {
          ...restored,
          versions,
        },
      } as never)
      toast.success(`Restored ${version.label}`)
    },
    [activeFile, artifact.id, patchArtifact, sessionId],
  )

  const handleEdit = useCallback(
    (next: string) => {
      const editedPath = activeFile
      setFiles((cur) => {
        const updated = cur.map((f) =>
          f.path === editedPath ? { ...f, content: next } : f,
        )
        filesRef.current = updated
        return updated
      })
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
    const normalized = normalizeLatexProjectPath(path)
    if (!normalized || normalized === activeFile) return
    if (!filesRef.current.some((f) => f.path === normalized)) {
      toast.warn(`File "${normalized}" is not in the Creator project.`)
      return
    }
    flushFiles(filesRef.current, normalized)
    setActiveFile(normalized)
  }

  const handleBlur = () => flushFiles(filesRef.current, activeFile)

  const handleSetRootFile = (path: string) => {
    const normalized = normalizeLatexProjectPath(path)
    if (!normalized || !filesRef.current.some((f) => f.path === normalized)) {
      toast.warn(`File "${path}" is not in the Creator project.`)
      return
    }
    handlePatchPayload({ rootFile: normalized })
  }

  const handleRenameFile = async (path: string) => {
    const normalized = normalizeLatexProjectPath(path)
    const current = filesRef.current.find((f) => f.path === normalized)
    if (!normalized || !current) {
      toast.warn(`File "${path}" is not in the Creator project.`)
      return
    }
    const raw = await asyncPrompt({
      message: 'Rename Creator file',
      placeholder: normalized,
      defaultValue: normalized,
      okLabel: 'Rename',
    })
    if (!raw) return
    const nextPath = ensureLatexExtension(normalizeLatexProjectPath(raw))
    if (!nextPath) {
      toast.warn('Use a relative path inside this Creator project.')
      return
    }
    if (nextPath === normalized) return
    if (filesRef.current.some((f) => f.path === nextPath)) {
      toast.warn(`File "${nextPath}" already exists`)
      return
    }
    const next = filesRef.current.map((f) =>
      f.path === normalized
        ? { ...f, path: nextPath, kind: kindFromLatexPath(nextPath) }
        : f,
    )
    setFiles(next)
    const nextActive = activeFile === normalized ? nextPath : activeFile
    setActiveFile(nextActive)
    const currentPayload = payloadRef.current
    patchArtifact(sessionId, artifact.id, {
      payload: {
        ...currentPayload,
        files: next,
        activeFile: nextActive,
        rootFile: currentPayload.rootFile === normalized
          ? nextPath
          : resolveProjectFile(next, currentPayload.rootFile),
      },
    } as never)
  }

  const handleJumpToSource = useCallback(
    (err: LatexCompileError) => {
      const target = normalizeLatexProjectPath(err.file ?? '') || activeFile
      const targetFile = filesRef.current.some((f) => f.path === target)
        ? target
        : activeFile
      if (!filesRef.current.some((f) => f.path === targetFile)) return
      if (targetFile !== activeFile) {
        flushFiles(filesRef.current, targetFile)
        setActiveFile(targetFile)
      }
      setSourceJump((prev) => ({
        path: targetFile,
        line: Math.max(1, err.line ?? 1),
        seq: (prev?.seq ?? 0) + 1,
      }))
    },
    [activeFile, flushFiles],
  )

  const handleNewFile = async () => {
    const raw = await asyncPrompt({
      message: 'New Creator file path',
      placeholder: 'chapters/methods.tex',
      okLabel: 'Create',
    })
    if (!raw) return
    const path = ensureLatexExtension(normalizeLatexProjectPath(raw))
    if (!path) {
      toast.warn('Use a relative path inside this Creator project.')
      return
    }
    if (filesRef.current.some((f) => f.path === path)) {
      toast.warn(`File "${path}" already exists`)
      return
    }
    const kind = kindFromLatexPath(path)
    const next = [...filesRef.current, { path, kind, content: '' }]
    setFiles(next)
    flushFiles(next, path)
    setActiveFile(path)
  }

  /** Replace the full contents of one file (used by the AI assistant
   *  "Apply" button) and persist the update to the artifact store. */
  const applyFileContents = useCallback(
    (path: string, content: string) => {
      const normalized = normalizeLatexProjectPath(path)
      const current = filesRef.current
      if (!normalized || !current.some((f) => f.path === normalized)) {
        toast.warn(`File "${path}" is not in the Creator project.`)
        return
      }
      const next = current.map((f) =>
        f.path === normalized ? { ...f, content } : f,
      )
      saveVersion('Before AI apply', 'ai-apply')
      setFiles(next)
      filesRef.current = next
      // If we just overwrote the file the editor is currently showing,
      // bump the remount counter so CodeMirror picks up the new doc.
      if (normalized === activeFile) {
        applyVersionBumpRef.current = normalized
        setApplyVersion((v) => v + 1)
      } else {
        // Jump to the file we just changed so the user can see the new
        // contents immediately; also remount to load them.
        setActiveFile(normalized)
        applyVersionBumpRef.current = normalized
        setApplyVersion((v) => v + 1)
      }
      flushFiles(next, normalized)
    },
    [flushFiles, activeFile, saveVersion],
  )

  const handleCloseFile = (path: string) => {
    const normalized = normalizeLatexProjectPath(path)
    if (!normalized) return
    if (filesRef.current.length <= 1) {
      toast.warn('A LaTeX project must contain at least one file')
      return
    }
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Remove "${normalized}" from the Creator project?`)) {
      return
    }
    const next = filesRef.current.filter((f) => f.path !== normalized)
    const nextActive = normalized === activeFile ? next[0].path : activeFile
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
    const snapshot = normalizeLatexProjectFiles(filesRef.current)
    const compileRoot = resolveProjectFile(snapshot, current.rootFile)
    if (!snapshot.some((f) => f.path === compileRoot)) {
      toast.warn('This Creator project does not contain a compilable file.')
      return
    }
    const compileActive = resolveProjectFile(snapshot, activeFile, compileRoot)
    compileInFlightRef.current = true
    setCompilingSince(Date.now())
    setCompileSnapshot((s) => ({ ...s, status: 'compiling' }))
    patchArtifact(sessionId, artifact.id, {
      payload: {
        ...current,
        files: snapshot,
        activeFile: compileActive,
        rootFile: compileRoot,
        status: 'compiling' as const,
      },
    } as never)

    try {
      const runner = await getBusytexRunner()
      const result = await runner.compile({
        files: snapshot.map((f) => ({ path: f.path, contents: f.content })),
        rootFile: compileRoot,
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
          activeFile: compileActive,
          rootFile: compileRoot,
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
          <div className="latex-focus-source-title">
            <FileCode2 size={14} aria-hidden />
            <span className="latex-focus-source-path" title={activeFile}>
              {activeFile}
            </span>
          </div>
          <FocusHeaderActions
            status={compileSnapshot.status}
            drawerTab={drawerTab}
            setDrawerTab={setDrawerTab}
            issueCount={issueCount}
            compilingSince={compilingSince}
            onCompile={() => void compile()}
            collabActive={Boolean(normalizedCollaboration?.enabled)}
            collabConnected={collaborationRuntime.status === 'connected'}
            onOpenCollab={() => setDrawerTab('details')}
          />
        </header>

        <div className="latex-focus-body" ref={bodyRef}>
          <ProjectRail
            files={files}
            activeFile={activeFile}
            rootFile={rootFile}
            onSwitchFile={handleSwitchFile}
            onNewFile={handleNewFile}
            onCloseFile={handleCloseFile}
            onRenameFile={handleRenameFile}
            onSetRootFile={handleSetRootFile}
          />
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
                jumpToLine={
                  sourceJump?.path === active.path ? sourceJump.line : null
                }
                jumpToken={
                  sourceJump?.path === active.path ? sourceJump.seq : null
                }
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
                  onFixWithAi={handleFixWithAi}
                  onJumpToSource={handleJumpToSource}
                />
              ) : drawerTab === 'ai' ? (
                <LatexAgentChat
                  files={files}
                  activeFile={activeFile}
                  payload={normalizedPayload}
                  errors={compileSnapshot.errors}
                  warnings={compileSnapshot.warnings}
                  sessionId={sessionId}
                  artifactId={artifact.id}
                  onApplyFile={applyFileContents}
                  initialPrompt={aiAutoPrompt}
                  onInitialPromptConsumed={() => setAiAutoPrompt(null)}
                />
              ) : drawerTab === 'versions' ? (
                <LatexVersionsPane
                  versions={normalizedPayload.versions ?? []}
                  onCreateVersion={handleCreateManualVersion}
                  onRestoreVersion={handleRestoreVersion}
                />
              ) : (
                <LatexDetailsPane
                  documentTitle={artifact.title}
                  artifactId={artifact.id}
                  payload={normalizedPayload}
                  collaboration={normalizedCollaboration}
                  collaborationRuntime={collaborationRuntime}
                  onPatchPayload={handlePatchPayload}
                  workspaceRootPath={workspaceRootPath}
                  workspaceSync={workspaceSync}
                  onSyncWorkspace={handleManualWorkspaceSync}
                />
              )}
            </FocusDrawer>
          ) : null}
        </div>
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
          rootFile={rootFile}
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
              jumpToLine={
                sourceJump?.path === active.path ? sourceJump.line : null
              }
              jumpToken={
                sourceJump?.path === active.path ? sourceJump.seq : null
              }
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
              onFixWithAi={handleFixWithAi}
              onJumpToSource={handleJumpToSource}
            />
          ) : rightTab === 'versions' ? (
            <LatexVersionsPane
              versions={normalizedPayload.versions ?? []}
              onCreateVersion={handleCreateManualVersion}
              onRestoreVersion={handleRestoreVersion}
            />
          ) : (
            <LatexDetailsPane
              documentTitle={artifact.title}
              artifactId={artifact.id}
              payload={normalizedPayload}
              collaboration={normalizedCollaboration}
              collaborationRuntime={collaborationRuntime}
              onPatchPayload={handlePatchPayload}
              workspaceRootPath={workspaceRootPath}
              workspaceSync={workspaceSync}
              onSyncWorkspace={handleManualWorkspaceSync}
            />
          )}
        </CardRightPane>
      </div>

      <LatexAgentChat
        files={files}
        activeFile={activeFile}
        payload={normalizedPayload}
        errors={compileSnapshot.errors}
        warnings={compileSnapshot.warnings}
        sessionId={sessionId}
        artifactId={artifact.id}
        onApplyFile={applyFileContents}
        initialPrompt={aiAutoPrompt}
        onInitialPromptConsumed={() => setAiAutoPrompt(null)}
      />
    </div>
  )
}
