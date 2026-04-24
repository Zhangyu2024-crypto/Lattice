// Slash-command abstraction for Lattice-app.
//
// Shape ported from Claude Code's `src/types/command.ts` + `src/commands.ts`
// but stripped of CLI-only concepts (Ink `local-jsx`, remote-control bridge,
// plugin manifests, MCP/workflow sources). A Lattice command is one of three
// shapes:
//
//   - local   — returns text that is appended to the transcript as a system
//               message. No LLM turn.
//   - overlay — opens a modal via `modal-store`. Handler is synchronous and
//               mutates the store; may return a `prefill` payload so the
//               composer also gets pre-filled after the overlay opens.
//   - prompt  — expands to an LLM prompt string. Either submitted directly
//               (default) via `submitAgentPrompt`, or delivered to the
//               composer via `dispatchComposerPrefill` when `submit: false`.
//
// Source loaders for skills/plugins are stubbed (see `loaders/`) so they can
// grow later without touching `registry.ts` or `dispatch.ts`.

import type { ComposerPrefillRequest } from '../composer-bus'
import type { TranscriptMessage } from '../../types/session'
import type { ModelBinding } from '../model-routing'

export type CommandSource = 'builtin' | 'skill' | 'plugin'

export type CommandCaller = 'user' | 'palette' | 'llm'

/**
 * Runtime context handed to every command handler. The dispatcher builds
 * this at call time; handlers must not capture it across awaits beyond
 * their own execution.
 */
export interface CommandContext {
  sessionId: string | null
  transcript: TranscriptMessage[]
  signal: AbortSignal
  caller: CommandCaller
}

export type LocalCommandResult =
  | { kind: 'text'; text: string }
  | { kind: 'compact'; summary: string }
  | { kind: 'skip' }

/**
 * Shared metadata across all three command variants. Mirrors Claude Code's
 * `CommandBase` with CLI fields (`availability`, `isBridgeSafeCommand`,
 * `loadedFrom`) dropped.
 */
export interface CommandBase {
  /** Canonical name without the leading slash. Compared case-insensitively. */
  name: string
  description: string
  /** Extra names that also resolve to this command. */
  aliases?: string[]
  source: CommandSource
  /**
   * When false, hidden from the `/` typeahead. An LLM-facing SlashCommandTool
   * may still invoke it. Defaults to true.
   */
  userInvocable?: boolean
  /**
   * Feature-flag gate. Re-evaluated on every dispatch and every `listCommands`
   * call, so it must be cheap and deterministic.
   */
  isEnabled?: () => boolean
  /**
   * Hides the command from any future model-invocation surface (not wired
   * into the registry yet, but preserved so the shape is stable for the
   * PR that lands `SlashCommandTool`).
   */
  disableModelInvocation?: boolean
  /**
   * When set, auto-register a palette entry in this group. Omit to keep the
   * command slash-only. Kept as a free-form string so palette builders can
   * choose grouping without a coupling layer here.
   */
  paletteGroup?: string
  /** Shown in typeahead hints (e.g. `<topic>`); not parsed. */
  argumentHint?: string
}

export interface LocalCommand extends CommandBase {
  type: 'local'
  call: (args: string, ctx: CommandContext) => Promise<LocalCommandResult>
}

export interface OverlayCommand extends CommandBase {
  type: 'overlay'
  call: (
    args: string,
    ctx: CommandContext,
  ) => { prefill?: ComposerPrefillRequest } | void
}

export interface PromptCommand extends CommandBase {
  type: 'prompt'
  /**
   * When true (default), the expanded prompt is submitted immediately via
   * `submitAgentPrompt`. When false, it is delivered to the composer via
   * `dispatchComposerPrefill` so the user can edit before sending.
   */
  submit?: boolean
  /** Override the agent-loop iteration ceiling for this single turn. */
  maxIterations?: number
  /**
   * Optional model override. When set, the dispatcher attaches this as
   * `modelBindingOverride` to the resulting `submitAgentPrompt` call, so
   * the command's turn uses the declared model regardless of session
   * `/model` state. Partial bindings are allowed — unspecified fields
   * fall through to the next layer in the resolver.
   */
  model?: ModelBinding
  getPrompt: (args: string, ctx: CommandContext) => Promise<string>
}

export type Command = LocalCommand | OverlayCommand | PromptCommand

/** Narrowing predicates — handy in the dispatcher and in tests. */
export function isLocalCommand(c: Command): c is LocalCommand {
  return c.type === 'local'
}
export function isOverlayCommand(c: Command): c is OverlayCommand {
  return c.type === 'overlay'
}
export function isPromptCommand(c: Command): c is PromptCommand {
  return c.type === 'prompt'
}
