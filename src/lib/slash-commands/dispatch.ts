// Dispatcher — pure logic, no React or store imports. The composer supplies
// the three hooks (`appendSystemMessage`, `submitAgentPrompt`, `prefill`) so
// this file stays unit-testable without a DOM or Zustand mock.
//
// Flow:
//
//   parseSlashCommand(text)     → `null` means legacy path, bail.
//   findCommand(name)           → 404 becomes an `appendSystemMessage`.
//   gates (isEnabled/userInvocable) → silent skip or 404-style message.
//   switch (cmd.type)
//     local    → cmd.call(args, ctx) → LocalCommandResult → hook.
//     overlay  → cmd.call(args, ctx) mutates modal-store; optional prefill.
//     prompt   → await cmd.getPrompt(args, ctx); submit or prefill.
//
// `ctx.caller === 'llm'` bypasses the `userInvocable` check so a future
// SlashCommandTool can invoke commands that are hidden from the user's
// typeahead.

import type {
  Command,
  CommandContext,
  LocalCommandResult,
} from './types'
import type { ComposerPrefillRequest } from '../composer-bus'
import type { ModelBinding } from '../model-routing'

export interface DispatchHooks {
  /**
   * Append a system-role message into the active session transcript. Used
   * by `local` results of kind `'text'` and by the 404 / disabled paths.
   */
  appendSystemMessage: (text: string) => void
  /**
   * Submit an LLM turn. `displayText` lets the transcript show a short
   * human-readable line while the model sees the full expanded scaffold.
   */
  submitAgentPrompt: (
    text: string,
    opts: {
      displayText?: string
      maxIterations?: number
      modelBindingOverride?: ModelBinding
    },
  ) => Promise<boolean> | void
  /** Fill the composer textarea without sending. */
  prefill: (req: ComposerPrefillRequest) => void
}

export type DispatchOutcome =
  | { kind: 'handled' }
  | { kind: 'unknown'; name: string }
  | { kind: 'disabled'; name: string }
  | { kind: 'hidden'; name: string }

/**
 * Dispatch a parsed slash command. Returns the outcome so callers (e.g. the
 * composer) can decide whether to clear the draft — unknown / disabled
 * still counts as "we handled it, don't send this as a regular message".
 */
export async function dispatchSlashCommand(
  cmd: Command | undefined,
  args: string,
  ctx: CommandContext,
  hooks: DispatchHooks,
  rawName = '',
): Promise<DispatchOutcome> {
  if (!cmd) {
    const shown = rawName || '(empty)'
    hooks.appendSystemMessage(`Unknown command /${shown}.`)
    return { kind: 'unknown', name: shown }
  }

  if (cmd.isEnabled && cmd.isEnabled() === false) {
    hooks.appendSystemMessage(
      `Command /${cmd.name} is disabled in this build.`,
    )
    return { kind: 'disabled', name: cmd.name }
  }

  // `userInvocable: false` hides a command from human typeahead but leaves
  // it reachable via the LLM path. We match that by only enforcing the flag
  // when the caller is user-driven.
  if (
    cmd.userInvocable === false &&
    (ctx.caller === 'user' || ctx.caller === 'palette')
  ) {
    hooks.appendSystemMessage(`Command /${cmd.name} is not user-invocable.`)
    return { kind: 'hidden', name: cmd.name }
  }

  if (cmd.type === 'local') {
    const result = await cmd.call(args, ctx)
    handleLocalResult(result, hooks)
    return { kind: 'handled' }
  }

  if (cmd.type === 'overlay') {
    const out = cmd.call(args, ctx)
    if (out?.prefill) hooks.prefill(out.prefill)
    return { kind: 'handled' }
  }

  // type === 'prompt'
  const expanded = await cmd.getPrompt(args, ctx)
  if (cmd.submit === false) {
    hooks.prefill({
      text: expanded,
      mode: 'agent',
      maxIterations: cmd.maxIterations,
    })
  } else {
    const displayText = args
      ? `/${cmd.name} ${args}`
      : `/${cmd.name}`
    await hooks.submitAgentPrompt(expanded, {
      displayText,
      maxIterations: cmd.maxIterations,
      // Skill-declared model becomes a per-request override, so the
      // prompt command's turn resolves with that binding in place — and
      // `sendLlmChat`'s resolver treats it as layer #2 (below per-request,
      // above session).
      modelBindingOverride: cmd.model,
    })
  }
  return { kind: 'handled' }
}

function handleLocalResult(
  result: LocalCommandResult,
  hooks: DispatchHooks,
): void {
  switch (result.kind) {
    case 'text':
      hooks.appendSystemMessage(result.text)
      return
    case 'compact':
      // Compact results are reserved for status-line / toast surfaces we
      // don't have wired yet. Falling back to a system message keeps the
      // user informed instead of silently dropping the output.
      hooks.appendSystemMessage(result.summary)
      return
    case 'skip':
      return
  }
}
