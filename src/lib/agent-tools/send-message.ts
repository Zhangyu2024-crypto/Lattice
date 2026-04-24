import type { LocalTool } from '../../types/agent-tool'
import { getAgent } from '../sub-agent-registry'

interface Input {
  to: string
  message?: string
}

interface Output {
  agentId: string
  name: string
  status: string
  response?: string
  toolSteps?: number
  error?: string
}

export const sendMessageTool: LocalTool<Input, Output> = {
  name: 'send_message',
  description:
    'Check on or communicate with a spawned sub-agent. Provide the agent name or ID. '
    + 'If the agent is still running, returns its current status. If completed, returns '
    + 'the agent\'s final response. Use after spawn_agent(background=true) to retrieve results.',
  cardMode: 'silent',
  trustLevel: 'safe',
  inputSchema: {
    type: 'object',
    properties: {
      to: {
        type: 'string',
        description: 'Name or ID of the target agent (from spawn_agent output).',
      },
      message: {
        type: 'string',
        description: 'Optional message to the agent (currently used as a note; the agent\'s result is returned as-is).',
      },
    },
    required: ['to'],
  },
  async execute(input) {
    if (!input?.to) throw new Error('"to" is required — provide the agent name or ID')

    const entry = getAgent(input.to)
    if (!entry) {
      throw new Error(
        `No agent found with name or ID "${input.to}". Use list_agents to see available agents.`,
      )
    }

    if (entry.status === 'running') {
      if (entry.promise) {
        try {
          const result = await Promise.race([
            entry.promise,
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 100)),
          ])
          if (result) {
            return {
              agentId: entry.id,
              name: entry.name,
              status: entry.status,
              response: result.finalText,
              toolSteps: result.toolSteps.length,
              error: result.error,
            }
          }
        } catch {
          // still running
        }
      }
      return {
        agentId: entry.id,
        name: entry.name,
        status: 'running',
        response: `Agent "${entry.name}" is still working. Check back later.`,
      }
    }

    const result = entry.result
    return {
      agentId: entry.id,
      name: entry.name,
      status: entry.status,
      response: result?.finalText ?? '',
      toolSteps: result?.toolSteps.length ?? 0,
      error: result?.error,
    }
  },
}
