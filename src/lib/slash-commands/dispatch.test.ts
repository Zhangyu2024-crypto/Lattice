import { describe, expect, it, vi } from 'vitest'
import { dispatchSlashCommand, type DispatchHooks } from './dispatch'
import type {
  CommandContext,
  LocalCommand,
  OverlayCommand,
  PromptCommand,
} from './types'
import type { ComposerPrefillRequest } from '../composer-bus'

function makeCtx(
  overrides: Partial<CommandContext> = {},
): CommandContext {
  return {
    sessionId: 'sess-1',
    transcript: [],
    signal: new AbortController().signal,
    caller: 'user',
    ...overrides,
  }
}

function makeHooks(): DispatchHooks {
  return {
    appendSystemMessage: vi.fn<(text: string) => void>(),
    submitAgentPrompt: vi.fn<
      (
        text: string,
        opts: { displayText?: string; maxIterations?: number },
      ) => Promise<boolean>
    >(async () => true),
    prefill: vi.fn<(req: ComposerPrefillRequest) => void>(),
  }
}

describe('dispatchSlashCommand unknown/gated paths', () => {
  it('reports an unknown command via system message', async () => {
    const hooks = makeHooks()
    const out = await dispatchSlashCommand(
      undefined,
      '',
      makeCtx(),
      hooks,
      'whatever',
    )
    expect(out).toEqual({ kind: 'unknown', name: 'whatever' })
    expect(hooks.appendSystemMessage).toHaveBeenCalledWith(
      'Unknown command /whatever.',
    )
  })

  it('refuses a disabled command', async () => {
    const cmd: LocalCommand = {
      type: 'local',
      name: 'x',
      description: 'x',
      source: 'builtin',
      isEnabled: () => false,
      call: vi.fn(),
    }
    const hooks = makeHooks()
    const out = await dispatchSlashCommand(cmd, '', makeCtx(), hooks)
    expect(out.kind).toBe('disabled')
    expect(cmd.call).not.toHaveBeenCalled()
    expect(hooks.appendSystemMessage).toHaveBeenCalledOnce()
  })

  it('hides userInvocable:false from user callers', async () => {
    const cmd: PromptCommand = {
      type: 'prompt',
      name: 'llm-only',
      description: 'x',
      source: 'builtin',
      userInvocable: false,
      getPrompt: vi.fn(async () => 'p'),
    }
    const hooks = makeHooks()
    const out = await dispatchSlashCommand(cmd, '', makeCtx({ caller: 'user' }), hooks)
    expect(out.kind).toBe('hidden')
    expect(cmd.getPrompt).not.toHaveBeenCalled()
  })

  it('lets llm callers invoke userInvocable:false commands', async () => {
    const cmd: PromptCommand = {
      type: 'prompt',
      name: 'llm-only',
      description: 'x',
      source: 'builtin',
      userInvocable: false,
      getPrompt: vi.fn(async () => 'expanded'),
    }
    const hooks = makeHooks()
    const out = await dispatchSlashCommand(cmd, 'args', makeCtx({ caller: 'llm' }), hooks)
    expect(out).toEqual({ kind: 'handled' })
    expect(cmd.getPrompt).toHaveBeenCalledWith('args', expect.anything())
    expect(hooks.submitAgentPrompt).toHaveBeenCalled()
  })
})

describe('dispatchSlashCommand branches', () => {
  it('local: text result goes to appendSystemMessage', async () => {
    const cmd: LocalCommand = {
      type: 'local',
      name: 'echo',
      description: '',
      source: 'builtin',
      call: async (args) => ({ kind: 'text', text: `got ${args}` }),
    }
    const hooks = makeHooks()
    await dispatchSlashCommand(cmd, 'hi', makeCtx(), hooks)
    expect(hooks.appendSystemMessage).toHaveBeenCalledWith('got hi')
  })

  it('local: skip result appends nothing', async () => {
    const cmd: LocalCommand = {
      type: 'local',
      name: 'noop',
      description: '',
      source: 'builtin',
      call: async () => ({ kind: 'skip' }),
    }
    const hooks = makeHooks()
    await dispatchSlashCommand(cmd, '', makeCtx(), hooks)
    expect(hooks.appendSystemMessage).not.toHaveBeenCalled()
  })

  it('overlay: calls handler, forwards optional prefill', async () => {
    const handler = vi.fn(() => ({
      prefill: { text: 'seed', mode: 'agent' as const },
    }))
    const cmd: OverlayCommand = {
      type: 'overlay',
      name: 'open',
      description: '',
      source: 'builtin',
      call: handler,
    }
    const hooks = makeHooks()
    await dispatchSlashCommand(cmd, 'tab', makeCtx(), hooks)
    expect(handler).toHaveBeenCalledWith('tab', expect.anything())
    expect(hooks.prefill).toHaveBeenCalledWith({
      text: 'seed',
      mode: 'agent',
    })
  })

  it('overlay: void return is fine', async () => {
    const cmd: OverlayCommand = {
      type: 'overlay',
      name: 'open',
      description: '',
      source: 'builtin',
      call: () => undefined,
    }
    const hooks = makeHooks()
    const out = await dispatchSlashCommand(cmd, '', makeCtx(), hooks)
    expect(out.kind).toBe('handled')
    expect(hooks.prefill).not.toHaveBeenCalled()
  })

  it('prompt: submit-true sends expanded text and a short display label', async () => {
    const cmd: PromptCommand = {
      type: 'prompt',
      name: 'research',
      description: '',
      source: 'builtin',
      maxIterations: 12,
      getPrompt: async (args) => `full scaffold for ${args}`,
    }
    const hooks = makeHooks()
    await dispatchSlashCommand(cmd, 'topic', makeCtx(), hooks)
    expect(hooks.submitAgentPrompt).toHaveBeenCalledWith(
      'full scaffold for topic',
      { displayText: '/research topic', maxIterations: 12 },
    )
    expect(hooks.prefill).not.toHaveBeenCalled()
  })

  it('prompt: submit-false takes the prefill path', async () => {
    const cmd: PromptCommand = {
      type: 'prompt',
      name: 'draft',
      description: '',
      source: 'builtin',
      submit: false,
      getPrompt: async () => 'here is a draft',
    }
    const hooks = makeHooks()
    await dispatchSlashCommand(cmd, '', makeCtx(), hooks)
    expect(hooks.prefill).toHaveBeenCalledWith({
      text: 'here is a draft',
      mode: 'agent',
      maxIterations: undefined,
    })
    expect(hooks.submitAgentPrompt).not.toHaveBeenCalled()
  })
})
