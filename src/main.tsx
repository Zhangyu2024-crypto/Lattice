import React, { Suspense, lazy, useMemo } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import AppErrorBoundary from './components/common/AppErrorBoundary'
import LogConsole from './components/common/LogConsole'
import ToastHost from './components/common/ToastHost'
import PromptHost from './components/common/PromptHost'
import StartupAuthGate from './components/startup/StartupAuthGate'
import { DEMO_LIBRARY } from './stores/demo-library'
import { preWarmRuntimePersist, useRuntimeStore } from './stores/runtime-store'
import { useArtifactDbStore } from './stores/artifact-db-store'
import { installGlobalErrorCapture } from './lib/global-error-capture'
import './styles/index.css'
import './lib/polyfills/uint8array-tohex'

// Structured error-capture (window/unhandledrejection/console/worker log)
// must be installed before React mounts so any crash during hydration or
// the first render is recorded with source + stack.
installGlobalErrorCapture()

const LibraryModal = lazy(() => import('./components/library/LibraryModal'))
const ProWorkbenchStandaloneView = lazy(
  () => import('./components/canvas/ProWorkbenchStandaloneView'),
)
const PdfReaderStandaloneView = lazy(
  () => import('./components/pdf/PdfReaderStandaloneView'),
)
const DataView = lazy(() => import('./components/data/DataView'))

function parseBootHash(): 'main' | 'library' | 'workbench' | 'pdf-reader' | 'data-manager' {
  const raw = window.location.hash.replace(/^#\/?/, '').split(/[?&]/)[0] ?? ''
  if (raw === 'library') return 'library'
  if (raw === 'workbench') return 'workbench'
  if (raw === 'pdf-reader') return 'pdf-reader'
  if (raw === 'data-manager') return 'data-manager'
  return 'main'
}

function LibraryWindowApp() {
  const close = () => {
    void window.electronAPI?.closeLibraryWindow()
  }
  return (
    <div className="app-satellite-host">
      <ToastHost />
      <LogConsole />
      <Suspense
        fallback={
          <div className="app-satellite-loading" role="status">
            Loading library…
          </div>
        }
      >
        <LibraryModal
          presentation="standalone"
          open
          data={DEMO_LIBRARY}
          onClose={close}
          onOpenPaper={() => {}}
        />
      </Suspense>
    </div>
  )
}

function ProWorkbenchWindowApp() {
  const parsed = useMemo(() => {
    const raw = window.location.hash.replace(/^#\/?/, '')
    const pathPart = raw.split(/[?&#]/)[0] ?? ''
    if (pathPart !== 'workbench') return null
    const q = raw.includes('?')
      ? raw.split('?').slice(1).join('?').split('#')[0] ?? ''
      : ''
    const params = new URLSearchParams(q)
    const sessionId = params.get('sessionId')
    const artifactId = params.get('artifactId')
    if (!sessionId || !artifactId) return null
    return { sessionId, artifactId }
  }, [])
  const close = () => void window.electronAPI?.closeWorkbenchWindow?.()
  if (!parsed) {
    return (
      <div className="app-satellite-host">
        <div className="app-satellite-loading" role="status">
          Invalid workbench link.
        </div>
      </div>
    )
  }
  return (
    <div className="app-satellite-host">
      <ToastHost />
      <LogConsole />
      <Suspense
        fallback={
          <div className="app-satellite-loading" role="status">
            Loading workbench…
          </div>
        }
      >
        <ProWorkbenchStandaloneView
          sessionId={parsed.sessionId}
          artifactId={parsed.artifactId}
          onCloseWindow={close}
        />
      </Suspense>
    </div>
  )
}

function PdfReaderWindowApp() {
  const parsed = useMemo(() => {
    const raw = window.location.hash.replace(/^#\/?/, '')
    const q = raw.includes('?')
      ? raw.split('?').slice(1).join('?').split('#')[0] ?? ''
      : ''
    return new URLSearchParams(q).get('relPath')
  }, [])
  const close = () => void (window as unknown as { electronAPI?: { openPdfReaderWindow?: unknown } }).electronAPI

  if (!parsed) {
    return (
      <div className="app-satellite-host">
        <div className="app-satellite-loading" role="status">Invalid PDF reader link.</div>
      </div>
    )
  }
  return (
    <div className="app-satellite-host">
      <ToastHost />
      <LogConsole />
      <Suspense fallback={<div className="app-satellite-loading" role="status">Loading PDF reader…</div>}>
        <PdfReaderStandaloneView relPath={parsed} onCloseWindow={() => window.close()} />
      </Suspense>
    </div>
  )
}

function DataManagerWindowApp() {
  return (
    <div className="app-satellite-host" style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#1e1e1e', color: '#ccc' }}>
      <ToastHost />
      <LogConsole />
      <div
        className="pdf-reader-titlebar"
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderBottom: '1px solid #333', minHeight: 36, fontWeight: 600, fontSize: "var(--text-base)" }}
      >
        Data Management
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <Suspense fallback={<div className="app-satellite-loading" role="status">Loading data manager…</div>}>
          <DataView />
        </Suspense>
      </div>
    </div>
  )
}

function hydrateRendererStores(): void {
  void Promise.all([
    preWarmRuntimePersist().then(() => useRuntimeStore.persist.rehydrate()),
    useArtifactDbStore.getState().hydrate(),
  ]).catch((err) => {
    console.warn('[startup] background hydration failed:', err)
  })
}

const boot = parseBootHash()
const mountRoot = ReactDOM.createRoot(document.getElementById('root')!)

mountRoot.render(
  <React.StrictMode>
    <AppErrorBoundary>
      {boot === 'main' ? (
        <StartupAuthGate>
          <App />
        </StartupAuthGate>
      ) : boot === 'library' ? (
        <LibraryWindowApp />
      ) : boot === 'workbench' ? (
        <ProWorkbenchWindowApp />
      ) : boot === 'pdf-reader' ? (
        <PdfReaderWindowApp />
      ) : boot === 'data-manager' ? (
        <DataManagerWindowApp />
      ) : null}
    </AppErrorBoundary>
  </React.StrictMode>,
)

hydrateRendererStores()
