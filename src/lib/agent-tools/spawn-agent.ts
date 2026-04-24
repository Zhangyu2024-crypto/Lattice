import type { LocalTool } from '../../types/agent-tool'
import { runAgentTurn } from '../agent-orchestrator'
import type { ModelBinding } from '../model-routing'
import { LOCAL_TOOL_CATALOG } from './index'
import {
  genAgentId,
  registerAgent,
  getAgent,
  type SubAgentEntry,
} from '../sub-agent-registry'

interface Input {
  prompt: string
  name?: string
  background?: boolean
  maxIterations?: number
  /**
   * Optional model override for the sub-agent's own LLM loop. Wins over
   * the session-level `/model` / `/fast` state (same precedence as
   * per-request overrides from the composer). Partial bindings are
   * honored — unspecified fields fall through to the parent's resolution
   * layers.
   */
  model?: ModelBinding
}

interface Output {
  agentId: string
  name: string
  status: 'completed' | 'running' | 'failed'
  result?: string
  toolSteps?: number
  error?: string
}

export const spawnAgentTool: LocalTool<Input, Output> = {
  name: 'spawn_agent',
  description:
    'Spawn a sub-agent to handle a task independently. The sub-agent runs its own '
    + 'LLM loop with the full tool catalog, sharing the parent session\'s artifacts '
    + 'and workspace. Use background=true for parallel work (returns immediately with '
    + 'an agentId you can query via send_message); use background=false (default) to '
    + 'wait for the result. Good for: parallel research, delegating complex sub-tasks, '
    + 'getting a second opinion on analysis results.',
  cardMode: 'info',
  trustLevel: 'sandboxed',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'Task instruction for the sub-agent. Be specific — it has no memory of the parent conversation.',
      },
      name: {
        type: 'string',
        description: 'Optional name for the agent (used by send_message to address it).',
      },
      background: {
        type: 'boolean',
        description: 'If true, run in background and return immediately. Default false (wait for result).',
      },
      maxIterations: {
        type: 'number',
        description: 'Max tool-loop iterations for the sub-agent. Default 20.',
      },
      model: {
        type: 'object',
        description:
          'Optional model for the sub-agent. Object with optional '
          + '{providerId, modelId, reasoningEffort}. Omit to inherit the '
          + "parent's active model / session overrides.",
      },
    },
    required: ['prompt'],
  },
  async execute(input, ctx) {
    if (!input?.prompt) throw new Error('prompt is required')

    const agentId = genAgentId()
    const name = input.name || agentId
    const maxIterations = Math.min(Math.max(input.maxIterations ?? 20, 1), 50)

    const entry: SubAgentEntry = {
      id: agentId,
      name,
      prompt: input.prompt,
      status: 'running',
      result: null,
      promise: null,
      createdAt: Date.now(),
      completedAt: null,
    }

    const runAgent = async () => {
      try {
        const result = await runAgentTurn({
          sessionId: ctx.sessionId,
          userMessage: input.prompt,
          transcript: [],
          tools: LOCAL_TOOL_CATALOG,
          signal: ctx.signal,
          maxIterations,
          modelBindingOverride: input.model,
        })
        entry.status = result.success ? 'completed' : 'failed'
        entry.result = result
        entry.completedAt = Date.now()
        return result
      } catch (err) {
        entry.status = 'failed'
        entry.result = {
          success: false,
          finalText: '',
          toolSteps: [],
          error: err instanceof Error ? err.message : String(err),
        }
        entry.completedAt = Date.now()
        throw err
      }
    }

    if (input.background) {
      entry.promise = runAgent()
      registerAgent(entry)
      return {
        agentId,
        name,
        status: 'running',
        result: `Sub-agent "${name}" spawned in background. Use send_message(to="${name}") to check results.`,
      }
    }

    registerAgent(entry)
    const result = await runAgent()

    return {
      agentId,
      name,
      status: result.success ? 'completed' : 'failed',
      result: result.finalText,
      toolSteps: result.toolSteps.length,
      error: result.error,
    }
  },
}

export const listAgentsTool: LocalTool<Record<string, never>, { agents: Array<{ id: string; name: string; status: string; prompt: string }> }> = {
  name: 'list_agents',
  description: 'List all spawned sub-agents and their current status.',
  cardMode: 'silent',
  trustLevel: 'safe',
  inputSchema: { type: 'object', properties: {} },
  async execute() {
    const { listAgents } = await import('../sub-agent-registry')
    const all = listAgents()
    return {
      agents: all.map((a) => ({
        id: a.id,
        name: a.name,
        status: a.status,
        prompt: a.prompt.slice(0, 200),
      })),
    }
  },
}
