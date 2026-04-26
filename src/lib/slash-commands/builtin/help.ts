import type { LocalCommand } from '../types'
import { listCommands } from '../registry'
import { getSkillLoadErrors } from '../loaders/skills'
import { getPluginLoadErrors } from '../loaders/plugins'
import { getMcpLoadErrors } from '../loaders/mcp'

const COMMAND_LABELS: Record<string, string> = {
  research: '开始文献研究',
  clear: '清空当前对话',
  settings: '打开设置',
  library: '打开文献库',
  help: '查看帮助',
}

const PRIMARY_ORDER = ['research', 'clear', 'settings', 'library', 'help']

export const helpCommand: LocalCommand = {
  type: 'local',
  name: 'help',
  description: 'List available slash commands',
  source: 'builtin',
  aliases: ['?'],
  paletteGroup: 'Help',
  call: async () => {
    const commands = listCommands({ userInvocableOnly: true, enabledOnly: true })
    const byName = new Map(commands.map((cmd) => [cmd.name, cmd]))
    const render = (name: string): string | null => {
      const cmd = byName.get(name)
      if (!cmd) return null
      const hint = cmd.argumentHint ? ` ${cmd.argumentHint}` : ''
      return `/${cmd.name}${hint.padEnd(Math.max(1, 18 - cmd.name.length))} ${COMMAND_LABELS[cmd.name] ?? cmd.description}`
    }
    const primaryRows = PRIMARY_ORDER.map(render).filter(Boolean)
    const customRows = commands
      .filter((cmd) => !PRIMARY_ORDER.includes(cmd.name))
      .map((cmd) => {
        const hint = cmd.argumentHint ? ` ${cmd.argumentHint}` : ''
        return `/${cmd.name}${hint}  ${cmd.description}`
      })
      .sort()

    const parts: string[] = []
    if (primaryRows.length > 0) {
      parts.push(`可用命令：\n${primaryRows.join('\n')}`)
    } else {
      parts.push('暂无可用命令。')
    }
    if (customRows.length > 0) {
      parts.push(`扩展命令：\n${customRows.join('\n')}`)
    }
    const commandsSection = parts.join('\n\n')

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
