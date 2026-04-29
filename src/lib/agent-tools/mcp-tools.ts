// `mcp_list_tools` / `mcp_call_tool` — agent surface for invoking
// tools on connected MCP servers.
//
// Both tools just thin-wrap the IPC handlers exposed in `preload.ts`:
//   - `electronAPI.mcpListTools()` returns the cached `tools/list` of
//     every running stdio MCP client (see `electron/ipc-mcp.ts`).
//   - `electronAPI.mcpCallTool({serverId, name, args, approvalToken})`
//     dispatches a `tools/call` to that client.
//
// The call path is hostExec — the renderer mints an approval token via
// `issueApprovalToken` so the user has accepted the call (or granted a
// session allow-list) before the IPC fires.

import type { LocalTool } from '../../types/agent-tool'

interface ListInput {
  serverId?: string
}

interface ListedTool {
  serverId: string
  serverName: string
  name: string
  description?: string
  inputSchema?: unknown
}

interface ListOutput {
  ok: true
  tools: ListedTool[]
  errors: Array<{ serverId: string; name: string; message: string }>
}

export const mcpListToolsTool: LocalTool<ListInput, ListOutput> = {
  name: 'mcp_list_tools',
  description:
    'List tools exposed by connected MCP servers. Each entry includes serverId + name; pass both back to mcp_call_tool. Optionally filter to one serverId.',
  cardMode: 'silent',
  inputSchema: {
    type: 'object',
    properties: {
      serverId: {
        type: 'string',
        description: 'Filter to a single MCP server id.',
      },
    },
  },
  async execute(input) {
    if (!window.electronAPI?.mcpListTools) {
      throw new Error('mcp_list_tools requires the Electron shell')
    }
    const res = await window.electronAPI.mcpListTools()
    const tools = input?.serverId
      ? res.tools.filter((t) => t.serverId === input.serverId)
      : res.tools
    return { ok: true, tools, errors: res.errors }
  },
}

interface CallInput {
  serverId: string
  name: string
  args?: Record<string, unknown>
}

interface CallOutput {
  ok: true
  result: unknown
}

export const mcpCallToolTool: LocalTool<CallInput, CallOutput> = {
  name: 'mcp_call_tool',
  description:
    'Call a tool on a connected MCP server by serverId + name. `args` is the tool-specific input object (use mcp_list_tools first to see schemas). hostExec — user is prompted before each call unless they have granted a session allow-list.',
  trustLevel: 'hostExec',
  cardMode: 'review',
  inputSchema: {
    type: 'object',
    properties: {
      serverId: { type: 'string' },
      name: { type: 'string' },
      args: { type: 'object' },
    },
    required: ['serverId', 'name'],
  },
  async execute(input) {
    if (!window.electronAPI?.mcpCallTool || !window.electronAPI?.issueApprovalToken) {
      throw new Error('mcp_call_tool requires the Electron shell')
    }
    if (!input?.serverId) throw new Error('serverId is required')
    if (!input?.name) throw new Error('name is required')
    const args = input.args ?? {}
    const issued = await window.electronAPI.issueApprovalToken({
      toolName: 'mcp_call_tool',
      scope: {
        serverId: input.serverId,
        name: input.name,
        args: JSON.stringify(args),
      },
    })
    if (!issued.ok) throw new Error(issued.error)
    const res = await window.electronAPI.mcpCallTool({
      serverId: input.serverId,
      name: input.name,
      args,
      approvalToken: issued.token,
    })
    return { ok: true, result: res.result }
  },
}
