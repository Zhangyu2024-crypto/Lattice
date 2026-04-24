import { useEffect, useRef, useState } from 'react'
import { Settings as SettingsIcon, X } from 'lucide-react'
import { getArtifactDisplayTitle } from '../../lib/artifact-titles'
import { useRuntimeStore } from '../../stores/runtime-store'
import type { Artifact, ArtifactId } from '../../types/artifact'
import type { SessionId } from '../../types/session'
import ArtifactActionMenu from './ArtifactActionMenu'
import ParametersDrawer from './ParametersDrawer'
import { renderArtifactBody } from './artifact-body'
import ResearchProgressShell from '../research/ResearchProgressShell'

/** Artifacts allowed in the satellite `#/workbench` BrowserWindow. */
const STANDALONE_WORKBENCH_KINDS = new Set<Artifact['kind']>([
  'latex-document',
  'xrd-pro',
  'xps-pro',
  'raman-pro',
  'curve-pro',
  'spectrum-pro',
  'compute-pro',
  'research-report',
  'plot',
])

function kindBadge(kind: Artifact['kind']): string {
  switch (kind) {
    case 'xrd-pro':
      return 'XRD Lab'
    case 'xps-pro':
      return 'XPS Lab'
    case 'raman-pro':
      return 'Raman Lab'
    case 'curve-pro':
      return 'Curve Lab'
    case 'spectrum-pro':
      return 'Spectrum Lab'
    case 'compute-pro':
      return 'Compute Lab'
    case 'latex-document':
      return 'Creator'
    case 'research-report':
      return 'Research'
    case 'plot':
      return 'Plot'
    default:
      return ''
  }
}

function isSpectrumLabKind(kind: Artifact['kind']): boolean {
  return (
    kind === 'xrd-pro' ||
    kind === 'xps-pro' ||
    kind === 'raman-pro' ||
    kind === 'curve-pro' ||
    kind === 'spectrum-pro'
  )
}

interface Props {
  sessionId: SessionId
  artifactId: ArtifactId
  onCloseWindow: () => void
}

export default function ProWorkbenchStandaloneView({
  sessionId,
  artifactId,
  onCloseWindow,
}: Props) {
  const [paramsOpen, setParamsOpen] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resolvedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    const tryFocus = () => {
      if (resolvedRef.current) return true
      const s = useRuntimeStore.getState()
      const session = s.sessions[sessionId]
      const artifact = session?.artifacts[artifactId]
      if (!session || !artifact) return false
      if (!STANDALONE_WORKBENCH_KINDS.has(artifact.kind)) {
        setError('This artifact cannot open in a dedicated window.')
        resolvedRef.current = true
        return true
      }
      s.setActiveSession(sessionId)
      s.focusArtifact(sessionId, artifactId)
      document.title = `Lattice — ${getArtifactDisplayTitle(artifact)}`
      resolvedRef.current = true
      setReady(true)
      return true
    }

    const run = () => {
      if (cancelled) return
      tryFocus()
    }

    const unsubHydration = useRuntimeStore.persist.onFinishHydration(() => {
      run()
    })
    if (useRuntimeStore.persist.hasHydrated()) {
      run()
    }
    const unsubStore = useRuntimeStore.subscribe(() => run())

    // Cross-window fallback: every time the parent window flushes its
    // persist write, mirror it into this window so ongoing agent updates
    // (section status→drafting→done, new citations, etc.) are visible in
    // real time. `storage` events fire only in windows OTHER than the
    // one that wrote, so there's no self-loop.
    //
    // We deliberately DO NOT guard on `resolvedRef.current` here — a
    // resolved window still needs the rehydrate on every subsequent
    // write, otherwise long-running flows like @research appear frozen
    // in the satellite while the main window's agent is actively
    // patching the artifact.
    const onStorage = (e: StorageEvent) => {
      if (cancelled) return
      if (e.key !== 'lattice.session') return
      void useRuntimeStore.persist.rehydrate()
    }
    window.addEventListener('storage', onStorage)

    const t = window.setTimeout(() => {
      if (!cancelled && !resolvedRef.current && !useRuntimeStore.getState().sessions[sessionId]?.artifacts[artifactId]) {
        setError('Workbench not found. Close this window and open the workbench again from the main window.')
      }
    }, 12_000)

    return () => {
      cancelled = true
      unsubHydration()
      unsubStore()
      window.removeEventListener('storage', onStorage)
      window.clearTimeout(t)
    }
  }, [sessionId, artifactId])

  const session = useRuntimeStore((s) => s.sessions[sessionId])
  const artifact = session?.artifacts[artifactId]

  if (error) {
    return (
      <div className="pro-workbench-standalone-error">
        <p>{error}</p>
        <button type="button" onClick={onCloseWindow}>
          Close window
        </button>
      </div>
    )
  }

  if (!ready || !session || !artifact || !STANDALONE_WORKBENCH_KINDS.has(artifact.kind)) {
    return (
      <div className="app-satellite-loading" role="status">
        Loading workbench…
      </div>
    )
  }

  if (artifact.kind === 'research-report') {
    return (
      <div className="pro-workbench-standalone-root">
        <ResearchProgressShell
          artifact={artifact}
          presentation="standalone"
          sessionId={session.id}
          onCloseWindow={onCloseWindow}
        />
      </div>
    )
  }

  const displayTitle = getArtifactDisplayTitle(artifact)
  const sourceLabel =
    artifact.sourceFile && artifact.sourceFile !== displayTitle
      ? artifact.sourceFile
      : null
  const isPinned = session.pinnedArtifactIds.includes(artifact.id)
  const compactWorkbenchChrome = isSpectrumLabKind(artifact.kind)

  return (
    <>
      <div className="artifact-canvas-root pro-workbench-standalone-root">
        <div
          className={`artifact-canvas-frame${
            compactWorkbenchChrome
              ? ' artifact-canvas-frame--standalone-workbench'
              : ''
          }`}
        >
          <div className="artifact-canvas-frame-header">
            <span className="artifact-canvas-frame-kind">
              {kindBadge(artifact.kind)}
            </span>
            {sourceLabel && (
              <span className="artifact-canvas-frame-source">{sourceLabel}</span>
            )}
            <span className="artifact-canvas-frame-spacer" />
            <button
              title="Parameters"
              type="button"
              className="artifact-canvas-frame-btn"
              onClick={() => setParamsOpen(true)}
            >
              <SettingsIcon size={13} />
            </button>
            <ArtifactActionMenu
              artifact={artifact}
              sessionId={session.id}
              isPinned={isPinned}
            />
            <button
              type="button"
              title="Close window"
              className="artifact-canvas-frame-btn"
              onClick={onCloseWindow}
            >
              <X size={14} />
            </button>
          </div>
          <div data-artifact-body="true" className="artifact-canvas-frame-body">
            {renderArtifactBody(artifact, session, { embed: 'full' })}
          </div>
        </div>
      </div>
      <ParametersDrawer
        open={paramsOpen}
        onClose={() => setParamsOpen(false)}
        artifact={artifact}
        sessionId={session.id}
        sessionDefaults={session.paramSnapshot}
      />
    </>
  )
}
