import { lazy, Suspense } from 'react'
import { usePrefsStore } from '../../stores/prefs-store'
import ExplorerView from '../explorer/ExplorerView'

const DataView = lazy(() => import('../data/DataView'))
const LibrarySidebarView = lazy(() => import('./views/LibrarySidebarView'))
const WritingSidebarView = lazy(() => import('./views/WritingSidebarView'))
const ArtifactDbSidebarView = lazy(() => import('./views/ArtifactDbSidebarView'))

interface Props {
  onToggleSidebar?: () => void
  onOpenPaper: (
    paperId: string,
    metadata: {
      title: string
      authors: string[]
      year: number
      venue: string
      doi?: string
    },
    abstract: string,
  ) => void
  /** Open the full Library in a separate Electron window. Wired to the
   *  Library sidebar view's "external link" button. */
  onOpenLibraryWindow?: () => void
  onLoadLatexDemo: () => void
  onNewLatexDocument: () => void
  onLoadLatexTemplate: (templateId: string) => void
}

export default function Sidebar({
  onToggleSidebar,
  onOpenPaper,
  onOpenLibraryWindow,
  onLoadLatexDemo,
  onNewLatexDocument,
  onLoadLatexTemplate,
}: Props) {
  const activeView = usePrefsStore((s) => s.layout.activeView)

  const fallback = (
    <div className="sidebar-space-view">
      <div className="sidebar-space-scroll">
        <div className="sidebar-empty">Loading…</div>
      </div>
    </div>
  )

  switch (activeView) {
    case 'library':
      return (
        <Suspense fallback={fallback}>
          <LibrarySidebarView
            onOpenPaper={onOpenPaper}
            onOpenLibraryWindow={onOpenLibraryWindow}
            onCollapseSidebar={onToggleSidebar}
          />
        </Suspense>
      )
    case 'knowledge':
      return (
        <Suspense fallback={fallback}>
          <LibrarySidebarView
            onOpenPaper={onOpenPaper}
            onOpenLibraryWindow={onOpenLibraryWindow}
            onCollapseSidebar={onToggleSidebar}
          />
        </Suspense>
      )
    case 'writing':
      return (
        <Suspense fallback={fallback}>
          <WritingSidebarView
            onLoadLatexDemo={onLoadLatexDemo}
            onNewLatexDocument={onNewLatexDocument}
            onLoadLatexTemplate={onLoadLatexTemplate}
            onCollapseSidebar={onToggleSidebar}
          />
        </Suspense>
      )
    case 'data':
      return (
        <Suspense fallback={fallback}>
          <DataView />
        </Suspense>
      )
    case 'artifact-db':
      return (
        <Suspense fallback={fallback}>
          <ArtifactDbSidebarView onCollapseSidebar={onToggleSidebar} />
        </Suspense>
      )
    // Legacy 'session' view folds into the new file-first Explorer — see
    // Phase 6 refactor (workspace files are the single source of truth).
    case 'explorer':
    case 'session':
    default:
      return <ExplorerView />
  }
}
