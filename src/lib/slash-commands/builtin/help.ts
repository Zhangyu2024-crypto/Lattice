import type { LocalCommand } from '../types'
import { listCommands } from '../registry'
import { getSkillLoadErrors } from '../loaders/skills'
import { getPluginLoadErrors } from '../loaders/plugins'
import { getMcpLoadErrors } from '../loaders/mcp'

export const helpCommand: LocalCommand = {
  type: 'local',
  name: 'help',
  description: 'List available slash commands',
  source: 'builtin',
  aliases: ['?'],
  paletteGroup: 'Help',
  call: async () => {
    const rows = listCommands({ userInvocableOnly: true, enabledOnly: true })
      .map((c) => {
        const hint = c.argumentHint ? ` ${c.argumentHint}` : ''
        return `  /${c.name}${hint}  — ${c.description}`
      })
      .sort()
    const commandsSection = rows.length
      ? `Available slash commands:\n${rows.join('\n')}`
      : 'No slash commands registered.'

    const sections: string[] = [commandsSection]
    const skillErrors = getSkillLoadErrors()
    if (skillErrors.length > 0) {
      sections.push(
        `Skills that failed to load:\n${skillErrors
          .map((e) => `  ${e.fileName}: ${e.message}`)
          .join('\n')}`,
      )
    }
    const pluginErrors = getPluginLoadErrors()
    if (pluginErrors.length > 0) {
      sections.push(
        `Plugins that failed to load:\n${pluginErrors
          .map((e) => `  ${e.plugin}: ${e.message}`)
          .join('\n')}`,
      )
    }
    const mcpErrors = getMcpLoadErrors()
    if (mcpErrors.length > 0) {
      sections.push(
        `MCP servers that failed:\n${mcpErrors
          .map((e) => `  ${e.serverName}: ${e.message}`)
          .join('\n')}`,
      )
    }
    return { kind: 'text', text: sections.join('\n\n') }
  },
}
