import { useRuntimeStore } from '../../stores/runtime-store'
import type { AgentTask } from '../../types/session'
import type { LocalTool } from '../../types/agent-tool'

type AgentTaskStatus = AgentTask['status']

function genTaskId(): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `atask_${Date.now().toString(36)}_${rand}`
}

interface TaskCreateInput {
  subject: string
  description?: string
}

interface TaskCreateOutput {
  id: string
  status: AgentTaskStatus
}

/** Create a new agent-managed todo item in the current session. */
export const taskCreateTool: LocalTool<TaskCreateInput, TaskCreateOutput> = {
  name: 'task_create',
  description:
    'Create a new agent todo item (subject + optional description). Use to plan multi-step work; later mark items in_progress / completed via task_update.',
  trustLevel: 'localWrite',
  planModeAllowed: true,
  // Phase η — agent todo bookkeeping; info-only.
  cardMode: 'info',
  inputSchema: {
    type: 'object',
    properties: {
      subject: {
        type: 'string',
        description: 'Short imperative summary of the todo.',
      },
      description: {
        type: 'string',
        description: 'Optional longer description / acceptance criteria.',
      },
    },
    required: ['subject'],
  },
  async execute(input, ctx) {
    if (!input?.subject) throw new Error('subject is required')
    const now = Date.now()
    const task: AgentTask = {
      id: genTaskId(),
      subject: input.subject,
      description: input.description,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    }
    useRuntimeStore.getState().addAgentTask(ctx.sessionId, task)
    return { id: task.id, status: task.status }
  },
}

interface TaskListInput {
  /** No parameters; placeholder so the schema validator is happy. */
  _?: never
}

type TaskListOutput = AgentTask[]

/** List all agent-managed todo items for the current session. */
export const taskListTool: LocalTool<TaskListInput, TaskListOutput> = {
  name: 'task_list',
  description:
    'List all agent todo items for the current session, in creation order.',
  trustLevel: 'safe',
  planModeAllowed: true,
  cardMode: 'silent',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  async execute(_input, ctx) {
    const session = useRuntimeStore.getState().sessions[ctx.sessionId]
    return session?.agentTasks ?? []
  },
}

interface TaskUpdateInput {
  id: string
  status?: AgentTaskStatus
  subject?: string
  description?: string
}

interface TaskUpdateOutput {
  task: AgentTask
}

/** Update fields on an existing agent-managed todo item. */
export const taskUpdateTool: LocalTool<TaskUpdateInput, TaskUpdateOutput> = {
  name: 'task_update',
  description:
    'Update an agent todo item by id. Use to flip status (pending → in_progress → completed/cancelled) or revise its subject/description.',
  trustLevel: 'localWrite',
  planModeAllowed: true,
  // Phase η — agent todo bookkeeping; info-only.
  cardMode: 'info',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Task id returned by task_create.' },
      status: {
        type: 'string',
        description:
          'New status: pending | in_progress | completed | cancelled.',
      },
      subject: { type: 'string', description: 'Replacement subject text.' },
      description: {
        type: 'string',
        description: 'Replacement description text.',
      },
    },
    required: ['id'],
  },
  async execute(input, ctx) {
    if (!input?.id) throw new Error('id is required')
    const patch: Partial<Omit<AgentTask, 'id' | 'createdAt'>> = {}
    if (input.status) patch.status = input.status
    if (input.subject !== undefined) patch.subject = input.subject
    if (input.description !== undefined) patch.description = input.description
    useRuntimeStore.getState().updateAgentTask(ctx.sessionId, input.id, patch)
    const session = useRuntimeStore.getState().sessions[ctx.sessionId]
    const task = session?.agentTasks?.find((t) => t.id === input.id)
    if (!task) throw new Error(`Agent task not found: ${input.id}`)
    return { task }
  },
}
