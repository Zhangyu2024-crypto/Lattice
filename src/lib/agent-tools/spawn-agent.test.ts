import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock the orchestrator so the test doesn't try to reach an LLM.
const runAgentTurn = vi.fn<(args: Record<string, unknown>) => Promise<{
  success: boolean
  finalText: string
  toolSteps: unknown[]
}>>(async () => ({
  success: true,
  finalText: 'done',
  toolSteps: [],
}))

vi.mock('../agent-orchestrator', () => ({
  runAgentTurn: (args: Record<string, unknown>) => runAgentTurn(args),
}))

// The tool's default catalog wants to be imported, but it pulls in every
// other agent tool with their real dependencies (workspace IPC, etc). Stub
// it to an empty array — the sub-agent doesn't actually run here.
vi.mock('./index', () => ({ LOCAL_TOOL_CATALOG: [] }))

// sub-agent-registry is stateful; clear between tests by resetting its
// in-memory map through the public clear helper when available. The
// module exports `registerAgent` + `genAgentId`; we leave state alone
// because the test doesn't query back.
import { spawnAgentTool } from './spawn-agent'

const baseCtx = () => ({
  sessionId: 'sess-1',
  signal: new AbortController().signal,
})

beforeEach(() => {
  runAgentTurn.mockClear()
})

describe('spawn_agent model override', () => {
  it('threads input.model into runAgentTurn as modelBindingOverride', async () => {
    await spawnAgentTool.execute(
      {
        prompt: 'do a thing',
        model: { providerId: 'pid', modelId: 'mid', reasoningEffort: 'low' },
      },
      baseCtx() as Parameters<typeof spawnAgentTool.execute>[1],
    )
    expect(runAgentTurn).toHaveBeenCalledOnce()
    const args = runAgentTurn.mock.calls[0]?.[0] as
      | { modelBindingOverride?: unknown }
      | undefined
    expect(args?.modelBindingOverride).toEqual({
      providerId: 'pid',
      modelId: 'mid',
      reasoningEffort: 'low',
    })
  })

  it('leaves modelBindingOverride undefined when input.model is omitted', async () => {
    await spawnAgentTool.execute(
      { prompt: 'plain run' },
      baseCtx() as Parameters<typeof spawnAgentTool.execute>[1],
    )
    expect(runAgentTurn).toHaveBeenCalledOnce()
    const args = runAgentTurn.mock.calls[0]?.[0] as
      | { modelBindingOverride?: unknown }
      | undefined
    expect(args?.modelBindingOverride).toBeUndefined()
  })

  it('exposes the model field in the inputSchema', () => {
    expect(spawnAgentTool.inputSchema.properties.model).toBeDefined()
    expect(spawnAgentTool.inputSchema.required).not.toContain('model')
  })
})
