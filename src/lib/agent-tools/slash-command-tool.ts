// SlashCommandTool — lets the LLM invoke a slash command by name.
//
// Mirrors Claude Code's `SkillTool` (`src/tools/SkillTool/SkillTool.ts`):
// the model sees the set of `prompt`-type commands that are user-facing AND
// enabled, and may call this tool with `{ name, args? }`. The tool resolves
// the command's prompt scaffold and returns it as the tool result. The
// orchestrator then feeds that text back into the LLM's next turn, matching
// the "inline" execution context from Claude Code.
//
// v1 scope:
//   - Only `prompt`-type commands are reachable. `local` commands can't be
//     surfaced because they're designed to mutate transcript/UI (side effects
//     the model shouldn't trigger silently); `overlay` commands can't be
//     surfaced because they mutate modal-store UI state the LLM has no
//     business touching.
//   - We return the expanded prompt string rather than re-entering
//     `submitAgentPrompt`. That keeps the orchestrator's loop linear (no
//     re-entrancy) and lets the model reason about the expanded text the
//     same way it reasons about any other tool result.

import type { LocalTool } from '../../types/agent-tool'
import {
  findCommand,
  listCommands,
  isPromptCommand,
  type Command,
} from '../slash-commands'

interface SlashCommandToolInput {
  name: string
  args?: string
}

interface SlashCommandToolOutput {
  name: string
  expanded: string
}

function buildDescription(): string {
  const available = listCommands({
    userInvocableOnly: false,
    modelInvocableOnly: true,
    enabledOnly: true,
  }).filter(isPromptCommand)

  if (available.length === 0) {
    return (
      'Invoke a registered slash command by name and receive the expanded ' +
      'prompt as the tool result. No prompt-type commands are registered ' +
      'right now; this tool is a no-op until one is added.'
    )
  }

  const lines = available
    .map((cmd: Command) => {
      const hint = cmd.argumentHint ? ` ${cmd.argumentHint}` : ''
      return `  /${cmd.name}${hint} — ${cmd.description}`
    })
    .sort()

  return (
    'Invoke a registered slash command by name and receive the expanded ' +
    'prompt as the tool result. You can then act on the expanded text the ' +
    'same way you would act on any retrieved content. Available commands:\n' +
    lines.join('\n')
  )
}

export const slashCommandTool: LocalTool<
  SlashCommandToolInput,
  SlashCommandToolOutput
> = {
  name: 'invoke_slash_command',
  description: buildDescription(),
  trustLevel: 'safe',
  cardMode: 'info',
  planModeAllowed: true,
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description:
          'Canonical command name without the leading slash (e.g. "research").',
      },
      args: {
        type: 'string',
        description:
          'Optional argument string passed to the command. Shape depends on the command — check its argumentHint.',
      },
    },
    required: ['name'],
  },
  async execute(input, ctx) {
    if (!input?.name) throw new Error('name is required')
    const cmd = findCommand(input.name)
    if (!cmd) {
      throw new Error(
        `Unknown slash command /${input.name}. Call with a name from this tool's description.`,
      )
    }
    if (cmd.isEnabled && cmd.isEnabled() === false) {
      throw new Error(`Command /${cmd.name} is disabled in this build.`)
    }
    if (cmd.disableModelInvocation) {
      throw new Error(
        `Command /${cmd.name} is not available to the model (disableModelInvocation).`,
      )
    }
    if (!isPromptCommand(cmd)) {
      throw new Error(
        `Command /${cmd.name} is type='${cmd.type}'; only 'prompt' commands are reachable through this tool.`,
      )
    }
    const expanded = await cmd.getPrompt(input.args ?? '', {
      sessionId: ctx.sessionId,
      transcript: [],
      signal: ctx.signal,
      caller: 'llm',
    })
    return { name: cmd.name, expanded }
  },
}
