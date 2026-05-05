// MCP stdio-transport source for the slash-command registry.
//
// Main-process only: each enabled server in the renderer's
// `extensions-config-store` spawns a child process via the official
// `@modelcontextprotocol/sdk` stdio transport. We enumerate the server's
// `prompts` capability and cache the list; the renderer pulls it through
// `mcp:list-prompts`. Invocation goes through `mcp:get-prompt`, which
// forwards to the SDK's `prompts/get` and returns the flattened text.
//
// MCP tools are exposed through explicit list/call IPC and gated in the
// renderer as hostExec agent tools because server capabilities vary widely.

import { ipcMain, type BrowserWindow as BrowserWindowType } from 'electron'
import { consumeApprovalToken } from './ipc-approval-tokens'
import { summarizePayloadForAudit, writeAuditEvent } from './audit-writer'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

export interface McpServerSpec {
  id: string
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
}

export interface McpPromptSummary {
  serverId: string
  serverName: string
  name: string
  description?: string
  arguments?: Array<{ name: string; description?: string; required?: boolean }>
}

export interface McpToolSummary {
  serverId: string
  serverName: string
  name: string
  description?: string
  inputSchema?: unknown
}

interface RunningClient {
  id: string
  name: string
  client: Client
  transport: StdioClientTransport
  prompts: McpPromptSummary[]
  tools: McpToolSummary[]
}

const running = new Map<string, RunningClient>()
let lastErrors: Array<{ serverId: string; name: string; message: string }> = []

async function startClient(spec: McpServerSpec): Promise<RunningClient> {
  const transport = new StdioClientTransport({
    command: spec.command,
    args: spec.args,
    env: spec.env as Record<string, string> | undefined,
  })
  const client = new Client(
    { name: `lattice-app`, version: '0.1.0' },
    { capabilities: {} },
  )
  await client.connect(transport)

  let prompts: McpPromptSummary[] = []
  let tools: McpToolSummary[] = []
  try {
    const listed = await client.listPrompts()
    prompts = (listed.prompts ?? []).map((p) => ({
      serverId: spec.id,
      serverName: spec.name,
      name: p.name,
      description: p.description,
      arguments: p.arguments as McpPromptSummary['arguments'],
    }))
  } catch {
    // Some servers don't implement prompts/list — treat as empty set.
    prompts = []
  }

  try {
    const listed = await client.listTools()
    tools = (listed.tools ?? []).map((tool) => ({
      serverId: spec.id,
      serverName: spec.name,
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }))
  } catch {
    // Some servers don't implement tools/list — treat as empty set.
    tools = []
  }

  return { id: spec.id, name: spec.name, client, transport, prompts, tools }
}

async function shutdownClient(entry: RunningClient): Promise<void> {
  try {
    await entry.client.close()
  } catch {
    // best effort
  }
  try {
    await entry.transport.close()
  } catch {
    // best effort
  }
}

async function reconcile(
  desired: McpServerSpec[],
  broadcast: () => void,
): Promise<void> {
  const desiredIds = new Set(desired.map((s) => s.id))
  // Shut down servers the user disabled or removed.
  for (const [id, entry] of running) {
    if (!desiredIds.has(id)) {
      await shutdownClient(entry)
      running.delete(id)
    }
  }
  // Start / replace as needed. Restart entries whose command/args drifted.
  const errors: typeof lastErrors = []
  for (const spec of desired) {
    const existing = running.get(spec.id)
    const identical =
      existing &&
      existing.client &&
      existing.name === spec.name
    if (identical) continue
    if (existing) {
      await shutdownClient(existing)
      running.delete(spec.id)
    }
    try {
      const entry = await startClient(spec)
      running.set(spec.id, entry)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      errors.push({ serverId: spec.id, name: spec.name, message })
    }
  }
  lastErrors = errors
  broadcast()
}

export function registerMcpIpc(
  getWindows: () => BrowserWindowType[],
): void {
  const broadcast = () => {
    for (const win of getWindows()) {
      if (!win.isDestroyed()) win.webContents.send('mcp:prompts-changed')
    }
  }

  ipcMain.handle(
    'mcp:reconcile',
    async (_event, servers: McpServerSpec[]) => {
      await reconcile(servers ?? [], broadcast)
      return { running: [...running.keys()], errors: lastErrors }
    },
  )

  ipcMain.handle('mcp:list-prompts', () => {
    const prompts: McpPromptSummary[] = []
    for (const entry of running.values()) prompts.push(...entry.prompts)
    return { prompts, errors: lastErrors }
  })

  ipcMain.handle('mcp:list-tools', () => {
    const tools: McpToolSummary[] = []
    for (const entry of running.values()) tools.push(...entry.tools)
    return { tools, errors: lastErrors }
  })

  ipcMain.handle(
    'mcp:get-prompt',
    async (
      _event,
      payload: {
        serverId: string
        name: string
        args?: Record<string, string>
      },
    ) => {
      const entry = running.get(payload.serverId)
      if (!entry) throw new Error(`MCP server not running: ${payload.serverId}`)
      const result = await entry.client.getPrompt({
        name: payload.name,
        arguments: payload.args,
      })
      // Flatten the result's message list to a single string. Prompts
      // typically carry user-role turns; we concatenate with blank lines
      // so the receiving LLM sees the full multi-turn scaffold.
      const parts: string[] = []
      for (const msg of result.messages ?? []) {
        const content = msg.content as unknown
        if (typeof content === 'string') {
          parts.push(content)
        } else if (content && typeof content === 'object') {
          const c = content as { type?: string; text?: string }
          if (c.type === 'text' && typeof c.text === 'string') parts.push(c.text)
        }
      }
      return { text: parts.join('\n\n') }
    },
  )

  ipcMain.handle(
    'mcp:call-tool',
    async (
      _event,
      payload: {
        serverId: string
        name: string
        args?: Record<string, unknown>
        approvalToken?: string
      },
    ) => {
      const startedAt = Date.now()
      const auditMeta = {
        serverId: payload.serverId,
        name: payload.name,
        args: summarizePayloadForAudit(payload.args ?? {}),
      }
      writeAuditEvent({
        category: 'mcp',
        action: 'call_tool',
        status: 'started',
        metadata: auditMeta,
      })
      const tokenCheck = consumeApprovalToken(payload.approvalToken, 'mcp_call_tool', {
        serverId: payload.serverId,
        name: payload.name,
        args: JSON.stringify(payload.args ?? {}),
      })
      if (!tokenCheck.ok) {
        writeAuditEvent({
          category: 'mcp',
          action: 'call_tool',
          status: 'denied',
          durationMs: Date.now() - startedAt,
          metadata: auditMeta,
          error: tokenCheck.error,
        })
        throw new Error(tokenCheck.error)
      }
      try {
        const entry = running.get(payload.serverId)
        if (!entry) throw new Error(`MCP server not running: ${payload.serverId}`)
        const result = await entry.client.callTool({
          name: payload.name,
          arguments: payload.args,
        })
        writeAuditEvent({
          category: 'mcp',
          action: 'call_tool',
          status: 'success',
          durationMs: Date.now() - startedAt,
          metadata: {
            ...auditMeta,
            result: summarizePayloadForAudit(result),
          },
        })
        return { result }
      } catch (err) {
        writeAuditEvent({
          category: 'mcp',
          action: 'call_tool',
          status: 'error',
          durationMs: Date.now() - startedAt,
          metadata: auditMeta,
          error: err,
        })
        throw err
      }
    },
  )

}

export async function shutdownAllMcpClients(): Promise<void> {
  for (const entry of running.values()) await shutdownClient(entry)
  running.clear()
}
