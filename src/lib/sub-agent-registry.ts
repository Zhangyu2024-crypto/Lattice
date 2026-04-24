import type { RunAgentTurnResult } from './agent-orchestrator'

export interface SubAgentEntry {
  id: string
  name: string
  prompt: string
  status: 'running' | 'completed' | 'failed'
  result: RunAgentTurnResult | null
  promise: Promise<RunAgentTurnResult> | null
  createdAt: number
  completedAt: number | null
}

const agents = new Map<string, SubAgentEntry>()

let counter = 0

export function genAgentId(): string {
  counter += 1
  return `agent_${Date.now().toString(36)}_${counter}`
}

export function registerAgent(entry: SubAgentEntry): void {
  agents.set(entry.id, entry)
}

export function getAgent(idOrName: string): SubAgentEntry | undefined {
  const direct = agents.get(idOrName)
  if (direct) return direct
  for (const entry of agents.values()) {
    if (entry.name === idOrName) return entry
  }
  return undefined
}

export function listAgents(): SubAgentEntry[] {
  return [...agents.values()]
}

export function removeAgent(idOrName: string): boolean {
  const entry = getAgent(idOrName)
  if (!entry) return false
  return agents.delete(entry.id)
}

export function clearCompletedAgents(): number {
  let count = 0
  for (const [id, entry] of agents) {
    if (entry.status !== 'running') {
      agents.delete(id)
      count++
    }
  }
  return count
}
