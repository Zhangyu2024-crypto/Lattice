import { usePrefsStore } from '../../stores/prefs-store'
import DataView from '../data/DataView'
import LibrarySidebarView from './views/LibrarySidebarView'
import WritingSidebarView from './views/WritingSidebarView'
import ExplorerView from '../explorer/ExplorerView'
import ArtifactDbSidebarView from './views/ArtifactDbSidebarView'

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

  switch (activeView) {
    case 'library':
      return (
        <LibrarySidebarView
          onOpenPaper={onOpenPaper}
          onOpenLibraryWindow={onOpenLibraryWindow}
          onCollapseSidebar={onToggleSidebar}
        />
      )
    case 'knowledge':
      return (
        <LibrarySidebarView
          onOpenPaper={onOpenPaper}
          onOpenLibraryWindow={onOpenLibraryWindow}
          onCollapseSidebar={onToggleSidebar}
        />
      )
    case 'writing':
      return (
        <WritingSidebarView
          onLoadLatexDemo={onLoadLatexDemo}
          onNewLatexDocument={onNewLatexDocument}
          onLoadLatexTemplate={onLoadLatexTemplate}
          onCollapseSidebar={onToggleSidebar}
        />
      )
    case 'data':
      return <DataView />
    case 'artifact-db':
      return <ArtifactDbSidebarView onCollapseSidebar={onToggleSidebar} />
    // Legacy 'session' view folds into the new file-first Explorer — see
    // Phase 6 refactor (workspace files are the single source of truth).
    case 'explorer':
    case 'session':
    default:
      return <ExplorerView />
  }
}
