import { toast } from '../../../../stores/toast-store'
import { useRuntimeStore } from '../../../../stores/runtime-store'
import { openProWorkbenchAndRunCommand } from '../../../../lib/pro-workbench'
import type { SpectrumTechnique } from '../../../../types/artifact'
import type { Command } from '../types'

/**
 * Cross-workbench commands surface the most-used in-workbench actions
 * at the App-level palette. Each delegates to
 * `openProWorkbenchAndRunCommand(sessionId, technique, commandName)`
 * which reuses a previously-focused workbench for the technique or
 * spawns a fresh `spectrum-pro` artifact and waits for its command
 * registry to populate.
 *
 * The session lookup happens at dispatch time (not build time) because
 * the palette is rebuilt on every render and users may swap sessions
 * between opening and executing.
 */
export function buildCrossWorkbenchCommands(onClose: () => void): Command[] {
  const dispatch = (technique: SpectrumTechnique, commandName: string) =>
    () => {
      const sessionId = useRuntimeStore.getState().activeSessionId
      if (!sessionId) {
        toast.warn('Start a session first.')
        onClose()
        return
      }
      void openProWorkbenchAndRunCommand(
        sessionId,
        technique,
        commandName,
      ).then((r) => {
        if (!r.ok) toast.error(r.error)
      })
      onClose()
    }
  return [
    {
      id: 'domain-xrd-phases',
      label: 'XRD: Search Phase Database',
      action: dispatch('xrd', 'run search-phases'),
    },
    {
      id: 'domain-xrd-refine',
      label: 'XRD: Run Whole-pattern Fit',
      action: dispatch('xrd', 'run refine'),
    },
    {
      id: 'domain-xrd-detect',
      label: 'XRD: Detect Peaks',
      action: dispatch('xrd', 'run detect-peaks'),
    },
    {
      id: 'domain-xps-fit',
      label: 'XPS: Fit Peaks',
      action: dispatch('xps', 'run fit'),
    },
    {
      id: 'domain-xps-quantify',
      label: 'XPS: Quantify',
      action: dispatch('xps', 'run quantify'),
    },
    {
      id: 'domain-xps-lookup',
      label: 'XPS: BE Database Lookup',
      action: dispatch('xps', 'run lookup'),
    },
  ]
}
