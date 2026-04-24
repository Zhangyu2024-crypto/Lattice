import {
  Bookmark,
  BookOpen,
  Database,
  Feather,
  FolderOpen,
  FolderTree,
  Settings,
  SquareTerminal,
} from 'lucide-react'
import type { SidebarView } from '../../stores/prefs-store'

const ACTIVITY_ICON_SIZE = 20
const ACTIVITY_ICON_STROKE = 1.65

interface Props {
  sidebarVisible: boolean
  activeView: SidebarView
  onSelectView: (view: SidebarView) => void
  /** When provided, clicking the Library icon opens the full Library window
   *  (Electron) or modal (web) directly, skipping the sidebar-view step. */
  onOpenLibraryWindow?: () => void
  /** Open the Writing/Creator surface directly. In Electron this opens a
   *  dedicated workbench window; web falls back to sidebar-view switch. */
  onOpenWritingWindow?: () => void
  /** Open the Compute overlay (full-screen page inside the current window).
   *  Compute no longer has a sidebar view — this is its only entry point. */
  onOpenCompute: () => void
  /** Highlights the Compute icon while the overlay is open. */
  computeOverlayOpen?: boolean
  onOpenSettings: () => void
}

export default function ActivityBar({
  sidebarVisible,
  activeView,
  onSelectView,
  onOpenLibraryWindow,
  onOpenWritingWindow,
  onOpenCompute,
  computeOverlayOpen = false,
  onOpenSettings,
}: Props) {
  const isActiveView = (view: SidebarView) =>
    sidebarVisible && activeView === view

  const iconProps = {
    size: ACTIVITY_ICON_SIZE,
    strokeWidth: ACTIVITY_ICON_STROKE,
    className: 'activity-icon',
    'aria-hidden': true as const,
  }

  return (
    <div className="activity-bar">
      <button
        type="button"
        className={`activity-btn ${isActiveView('explorer') || isActiveView('session') ? 'active' : ''}`}
        onClick={() => onSelectView('explorer')}
        title="Explorer"
        aria-label="Explorer"
      >
        <FolderTree {...iconProps} />
      </button>
      <button
        type="button"
        className={`activity-btn ${isActiveView('library') ? 'active' : ''}`}
        onClick={() => {
          // Preferred path: directly open the floating Library window.
          // Fall back to the sidebar-view switch for contexts that haven't
          // wired the window opener (tests / storybook / web-only).
          if (onOpenLibraryWindow) {
            onOpenLibraryWindow()
            return
          }
          onSelectView('library')
        }}
        title="Library"
        aria-label="Library"
      >
        <BookOpen {...iconProps} />
      </button>
      {false && (
        <button
          type="button"
          className={`activity-btn ${computeOverlayOpen ? 'active' : ''}`}
          onClick={onOpenCompute}
          title="Compute"
          aria-label="Compute"
        >
          <SquareTerminal {...iconProps} />
        </button>
      )}
      {false && (
        <button
          type="button"
          className={`activity-btn ${isActiveView('writing') ? 'active' : ''}`}
          onClick={() => {
            if (onOpenWritingWindow) {
              onOpenWritingWindow()
              return
            }
            onSelectView('writing')
          }}
          title="Creator"
          aria-label="Creator"
        >
          <Feather {...iconProps} />
        </button>
      )}

      <button
        type="button"
        className={`activity-btn ${isActiveView('artifact-db') ? 'active' : ''}`}
        onClick={() => onSelectView('artifact-db')}
        title="Artifact Database"
        aria-label="Artifact Database"
      >
        <Bookmark {...iconProps} />
      </button>

      <div className="activity-bar-spacer" />

      {false && (
        <button
          type="button"
          className="activity-btn"
          onClick={() => {
            void (window as unknown as { electronAPI?: { openDataManagerWindow?: () => Promise<unknown> } })
              .electronAPI?.openDataManagerWindow?.()
          }}
          title="Data Management"
          aria-label="Data Management"
        >
          <Database {...iconProps} />
        </button>
      )}
      <button
        type="button"
        className="activity-btn"
        onClick={onOpenSettings}
        title="Settings (Ctrl+,)"
        aria-label="Settings"
      >
        <Settings {...iconProps} />
      </button>
    </div>
  )
}
