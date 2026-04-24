import { useEffect, useRef, useState } from 'react'
import { FolderOpen, RefreshCw } from 'lucide-react'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { getWorkspaceFs } from '../../lib/workspace/fs'
import EmptyState from './EmptyState'
import FileTree from './FileTree'

// Directory prefixes whose churn should NOT invalidate the explorer
// index. A root-level watch catches every file change in the workspace
// tree; on a real project `.git/` alone can fire hundreds of events per
// commit, and `node_modules/` rewrites on every `npm install`. Filtering
// at the watch boundary keeps `applyWatchEvent` from re-indexing the
// world in response to noise we never render.
const IGNORED_WATCH_PREFIXES: readonly string[] = [
  '.git/',
  '.git',
  'node_modules/',
  'node_modules',
  '.lattice/',
  '.lattice',
  'dist/',
  'dist-electron/',
  'release/',
  '.cache/',
  '.venv/',
  '__pycache__/',
]

function isIgnoredWatchPath(relPath: string): boolean {
  // Normalise so Windows-style separators don't slip through.
  const p = relPath.replace(/\\/g, '/')
  for (const prefix of IGNORED_WATCH_PREFIXES) {
    if (p === prefix || p.startsWith(prefix)) return true
  }
  return false
}
// SessionBar removed from sidebar — session management lives in the
// workspace topbar as a compact chip instead (see StatusBar.tsx).

export default function ExplorerView() {
  const rootPath = useWorkspaceStore((s) => s.rootPath)
  const hydrated = useWorkspaceStore((s) => s.hydrated)
  const loading = useWorkspaceStore((s) => s.loading)
  const error = useWorkspaceStore((s) => s.error)
  const hydrate = useWorkspaceStore((s) => s.hydrate)
  const setRoot = useWorkspaceStore((s) => s.setRoot)
  const refreshDir = useWorkspaceStore((s) => s.refreshDir)
  const applyWatchEvent = useWorkspaceStore((s) => s.applyWatchEvent)

  const [pickerError, setPickerError] = useState<string | null>(null)
  const watcherDisposeRef = useRef<(() => void) | null>(null)

  const hasElectron =
    typeof window !== 'undefined' &&
    !!(window as unknown as { electronAPI?: { openDirectory?: unknown } })
      .electronAPI?.openDirectory

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useEffect(() => {
    if (!rootPath) {
      if (watcherDisposeRef.current) {
        watcherDisposeRef.current()
        watcherDisposeRef.current = null
      }
      return
    }
    let disposed = false
    void (async () => {
      try {
        const fs = getWorkspaceFs()
        const dispose = await fs.watch('', (event) => {
          if ('relPath' in event && isIgnoredWatchPath(event.relPath)) return
          applyWatchEvent(event)
        })
        if (disposed) {
          dispose()
          return
        }
        watcherDisposeRef.current = dispose
      } catch {
        // watcher not available (e.g. Memory fs in pure-web mode); skip silently.
      }
    })()
    return () => {
      disposed = true
      if (watcherDisposeRef.current) {
        watcherDisposeRef.current()
        watcherDisposeRef.current = null
      }
    }
  }, [rootPath, applyWatchEvent])

  const handleOpen = async () => {
    setPickerError(null)
    try {
      const electronAPI = (
        window as unknown as {
          electronAPI?: {
            openDirectory: (opts?: Record<string, unknown>) => Promise<string | null>
          }
        }
      ).electronAPI
      if (!electronAPI) {
        setPickerError('Folder picker requires Electron shell.')
        return
      }
      const picked = await electronAPI.openDirectory({ title: 'Select workspace folder' })
      if (!picked) return
      await setRoot(picked)
    } catch (err) {
      setPickerError(err instanceof Error ? err.message : String(err))
    }
  }

  if (!hydrated || loading) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          padding: 14,
          fontSize: "var(--text-sm)",
          color: 'var(--fg-muted, #888)',
        }}
      >
        Loading workspace…
      </div>
    )
  }

  if (!rootPath) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <EmptyState
          onOpen={handleOpen}
          disabled={!hasElectron}
          error={pickerError ?? error}
        />
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 10px 6px 10px',
          borderBottom: '1px solid var(--border, #2a2a2a)',
          fontSize: "var(--text-xs)",
          color: 'var(--fg-muted, #9aa0a6)',
        }}
      >
        <FolderOpen size={14} strokeWidth={1.6} />
        <span
          style={{
            flex: 1,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={rootPath}
        >
          {rootPath}
        </span>
        <button
          type="button"
          onClick={() => void refreshDir('')}
          title="Refresh"
          aria-label="Refresh"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'inherit',
            cursor: 'pointer',
            padding: 2,
          }}
        >
          <RefreshCw size={12} strokeWidth={1.6} />
        </button>
        <button
          type="button"
          onClick={handleOpen}
          disabled={!hasElectron}
          title="Open another folder"
          style={{
            background: 'transparent',
            border: '1px solid var(--border, #333)',
            color: 'inherit',
            cursor: hasElectron ? 'pointer' : 'not-allowed',
            padding: '2px 6px',
            borderRadius: 3,
            fontSize: "var(--text-xxs)",
          }}
        >
          Change…
        </button>
      </div>
      {error ? (
        <div
          style={{
            padding: '6px 10px',
            background: 'var(--danger-bg, #3a1a1a)',
            color: 'var(--danger, #e5484d)',
            fontSize: "var(--text-xs)",
          }}
        >
          {error}
        </div>
      ) : null}
      <FileTree />
    </div>
  )
}
