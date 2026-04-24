import { toast } from '../../../../stores/toast-store'
import { callWorker, startWorker } from '../../../../lib/worker-client'
import type { Command } from '../types'

/** Inputs for session/open commands that land at the top of the palette. */
export interface SessionOpenerDeps {
  onClose: () => void
  onNewSession: () => void
  onOpenFile: () => void
}

/**
 * Top-of-list session commands: create a new session and attach a file.
 * Kept separate from the exporter bundle at the bottom so the visible order
 * in the palette matches user muscle memory.
 */
export function buildSessionOpenerCommands({
  onClose,
  onNewSession,
  onOpenFile,
}: SessionOpenerDeps): Command[] {
  return [
    {
      id: 'new-session',
      label: 'New Session',
      action: () => {
        onNewSession()
        onClose()
      },
    },
    {
      id: 'open',
      label: 'Add File to Session',
      shortcut: 'Ctrl+O',
      action: () => {
        onOpenFile()
        onClose()
      },
    },
  ]
}

/** Inputs for the tail-of-list "session I/O + panel toggles + worker probe" bundle. */
export interface SessionToolboxDeps {
  onClose: () => void
  onExportSession: () => void
  onExportSessionZip: () => void
  onToggleSidebar: () => void
  onToggleChat: () => void
}

/**
 * Bottom-of-list bundle: session export (JSON + zip), shell panel toggles,
 * and the Python-worker round-trip probe. Colocated because they all share
 * a "utility" flavor and the worker probe has the async lambda that was
 * noisy inline in the main file.
 */
export function buildSessionToolboxCommands({
  onClose,
  onExportSession,
  onExportSessionZip,
  onToggleSidebar,
  onToggleChat,
}: SessionToolboxDeps): Command[] {
  return [
    {
      id: 'export',
      label: 'Export Current Session (JSON)',
      action: () => {
        onExportSession()
        onClose()
      },
    },
    {
      id: 'export-zip',
      label: 'Export Current Session (.zip full snapshot)',
      action: () => {
        onExportSessionZip()
        onClose()
      },
    },
    {
      id: 'sidebar',
      label: 'Toggle Sidebar',
      shortcut: 'Ctrl+B',
      action: () => {
        onToggleSidebar()
        onClose()
      },
    },
    {
      id: 'chat',
      label: 'Toggle Agent Composer',
      shortcut: 'Ctrl+L',
      action: () => {
        onToggleChat()
        onClose()
      },
    },
    {
      id: 'worker-test',
      label: 'Test Python worker (echo round-trip)',
      action: () => {
        onClose()
        void (async () => {
          const startStatus = await startWorker()
          if (startStatus.state === 'failed') {
            toast.error(`Python worker failed to start: ${startStatus.error}`)
            return
          }
          const ping = await callWorker<{ python_version?: string }>(
            'system.echo',
            { ping: 'test' },
          )
          if (!ping.ok) {
            toast.error(`Worker echo failed: ${ping.error}`)
            return
          }
          const ver = ping.value?.python_version ?? 'unknown'
          toast.success(
            `Python worker OK · Python ${ver} · ${ping.durationMs}ms`,
          )
        })()
      },
    },
  ]
}
