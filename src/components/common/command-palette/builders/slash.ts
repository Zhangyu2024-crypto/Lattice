// Auto-register the slash-command registry's `paletteGroup` entries into
// the Command Palette. This keeps a single source of truth: a command that
// declares `paletteGroup: '<name>'` shows up both behind `/` in the composer
// and inside Ctrl+Shift+P, without a second manual registration.
//
// Actions route through the same `dispatchSlashCommand` entry point as the
// composer (caller: 'palette'), so any gating (`isEnabled`, `userInvocable`
// once we ship it) stays consistent across the two surfaces.

import type { Command as PaletteCommand } from '../types'
import {
  dispatchSlashCommand,
  findCommand,
  listCommands,
  type DispatchHooks,
} from '../../../../lib/slash-commands'
import { dispatchComposerPrefill } from '../../../../lib/composer-bus'
import {
  getActiveTranscript,
  useSessionStore,
} from '../../../../stores/session-store'
import { submitAgentPrompt } from '../../../../lib/agent-submit'

export interface SlashBuilderDeps {
  onClose: () => void
}

/**
 * Produce Command Palette entries for every registered slash command that
 * has a `paletteGroup` and is currently enabled + user-invocable. The
 * palette is re-built each render, so this reflects live registry state.
 */
export function buildSlashCommands({
  onClose,
}: SlashBuilderDeps): PaletteCommand[] {
  const cmds = listCommands({
    paletteOnly: true,
    userInvocableOnly: true,
    enabledOnly: true,
  })

  return cmds.map((cmd) => ({
    id: `slash-${cmd.name}`,
    label: `/${cmd.name}  ·  ${cmd.description}`,
    action: () => {
      onClose()
      void runFromPalette(cmd.name)
    },
  }))
}

async function runFromPalette(name: string): Promise<void> {
  const cmd = findCommand(name)
  if (!cmd) return

  const sessionId = useSessionStore.getState().activeSessionId
  const controller = new AbortController()

  const hooks: DispatchHooks = {
    appendSystemMessage: (body) => {
      if (!sessionId) return
      useSessionStore.getState().appendTranscript(sessionId, {
        id: `sys_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        role: 'system',
        content: body,
        timestamp: Date.now(),
      })
    },
    submitAgentPrompt: async (prompt, opts) => {
      if (!sessionId) return false
      const ses = useSessionStore.getState().sessions[sessionId]
      return submitAgentPrompt(prompt, {
        sessionId,
        transcript: ses ? getActiveTranscript(ses) : [],
        signal: controller.signal,
        displayText: opts.displayText,
        maxIterations: opts.maxIterations,
        modelBindingOverride: opts.modelBindingOverride,
      })
    },
    prefill: (req) => dispatchComposerPrefill(req),
  }

  const ses = sessionId ? useSessionStore.getState().sessions[sessionId] : null
  await dispatchSlashCommand(
    cmd,
    '',
    {
      sessionId,
      transcript: ses ? getActiveTranscript(ses) : [],
      signal: controller.signal,
      caller: 'palette',
    },
    hooks,
    name,
  )
}
