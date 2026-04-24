import { FolderOpen, FileText } from 'lucide-react'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { usePrefsStore } from '@/stores/prefs-store'
import { toast } from '@/stores/toast-store'

export default function WelcomePanel() {
  const rootPath = useWorkspaceStore((s) => s.rootPath)
  const setRoot = useWorkspaceStore((s) => s.setRoot)
  const setActiveView = usePrefsStore((s) => s.setActiveView)
  const setLayout = usePrefsStore((s) => s.setLayout)

  const pickWorkspace = async () => {
    const api = window.electronAPI
    if (!api?.openDirectory) {
      toast.error('Folder picker is only available in the Electron shell.')
      return
    }
    try {
      const picked = await api.openDirectory()
      if (!picked) return
      await setRoot(picked)
      setActiveView('explorer')
      setLayout({ sidebarVisible: true })
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to open workspace folder',
      )
    }
  }

  const revealExplorer = () => {
    setActiveView('explorer')
    setLayout({ sidebarVisible: true })
  }

  return (
    <div className="welcome-panel">
      <div className="welcome-panel-inner">
        <div className="welcome-panel-brand">Lattice Workspace</div>

        {rootPath ? (
          <>
            <p className="welcome-panel-lede">
              Workspace open at <code>{rootPath}</code>.
            </p>
            <p className="welcome-panel-hint">
              Double-click a file in the Explorer to open it here. Press
              <kbd>Ctrl</kbd>+<kbd>P</kbd> for Quick Open (coming soon).
            </p>
            <div className="welcome-panel-actions">
              <button
                type="button"
                className="welcome-panel-btn welcome-panel-btn--primary"
                onClick={revealExplorer}
              >
                <FileText size={14} strokeWidth={1.7} />
                Reveal Explorer
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="welcome-panel-lede">
              Pick a workspace folder to get started.
            </p>
            <p className="welcome-panel-hint">
              Lattice stores spectra, analyses, and chat transcripts as plain
              files on disk. You can open any folder as a workspace.
            </p>
            <div className="welcome-panel-actions">
              <button
                type="button"
                className="welcome-panel-btn welcome-panel-btn--primary"
                onClick={pickWorkspace}
              >
                <FolderOpen size={14} strokeWidth={1.7} />
                Choose Workspace Folder…
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
