// `plugin_list_tools` / `plugin_call_tool` — agent surface for tools
// declared by user-installed plugins under `<userData>/plugins/`.
//
// Same shape as `mcp-tools.ts` but routed through the plugin runtime
// in `electron/main.ts` (see `plugin:list-tools` / `plugin:call-tool`).

import type { LocalTool } from '../../types/agent-tool'

interface ListInput {
  plugin?: string
}

interface ListedTool {
  plugin: string
  name: string
  description?: string
  inputSchema?: unknown
}

interface ListOutput {
  ok: true
  tools: ListedTool[]
  errors: Array<{ plugin: string; message: string }>
}

export const pluginListToolsTool: LocalTool<ListInput, ListOutput> = {
  name: 'plugin_list_tools',
  description:
    'List tools declared by installed plugins. Each entry includes plugin id + tool name; pass both back to plugin_call_tool. Optionally filter to one plugin.',
  cardMode: 'silent',
  inputSchema: {
    type: 'object',
    properties: {
      plugin: {
        type: 'string',
        description: 'Filter to one plugin id.',
      },
    },
  },
  async execute(input) {
    if (!window.electronAPI?.pluginListTools) {
      throw new Error('plugin_list_tools requires the Electron shell')
    }
    const res = await window.electronAPI.pluginListTools()
    const tools = input?.plugin
      ? res.tools.filter((t) => t.plugin === input.plugin)
      : res.tools
    return { ok: true, tools, errors: res.errors }
  },
}

interface CallInput {
  plugin: string
  name: string
  input?: Record<string, unknown>
}

interface CallOutput {
  ok: true
  output: unknown
  stdout: string
  stderr: string
}

export const pluginCallToolTool: LocalTool<CallInput, CallOutput> = {
  name: 'plugin_call_tool',
  description:
    'Call a plugin-defined tool by plugin id + tool name. `input` is the tool-specific argument object (use plugin_list_tools first to see schemas). hostExec — user is prompted before each call unless they have granted a session allow-list.',
  trustLevel: 'hostExec',
  cardMode: 'review',
  inputSchema: {
    type: 'object',
    properties: {
      plugin: { type: 'string' },
      name: { type: 'string' },
      input: { type: 'object' },
    },
    required: ['plugin', 'name'],
  },
  async execute(input) {
    if (
      !window.electronAPI?.pluginCallTool ||
      !window.electronAPI?.issueApprovalToken
    ) {
      throw new Error('plugin_call_tool requires the Electron shell')
    }
    if (!input?.plugin) throw new Error('plugin is required')
    if (!input?.name) throw new Error('name is required')
    const toolInput = input.input ?? {}
    const issued = await window.electronAPI.issueApprovalToken({
      toolName: 'plugin_call_tool',
      scope: {
        plugin: input.plugin,
        name: input.name,
        input: JSON.stringify(toolInput),
      },
    })
    if (!issued.ok) throw new Error(issued.error)
    const res = await window.electronAPI.pluginCallTool({
      plugin: input.plugin,
      name: input.name,
      input: toolInput,
      approvalToken: issued.token,
    })
    return {
      ok: true,
      output: res.output,
      stdout: res.stdout,
      stderr: res.stderr,
    }
  },
}
