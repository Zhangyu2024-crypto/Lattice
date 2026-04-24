import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The tool description is computed at import time from the registry, so we
// mock the registry to a deterministic set before pulling the tool in.
vi.mock('../slash-commands/builtin', () => ({
  BUILTIN_COMMANDS: [
    {
      type: 'prompt',
      name: 'expand-me',
      description: 'Return a scaffold for the given topic',
      argumentHint: '<topic>',
      source: 'builtin',
      getPrompt: async (args: string) => `expanded(${args})`,
    },
    {
      type: 'prompt',
      name: 'model-hidden',
      description: 'Prompt command but hidden from the model',
      source: 'builtin',
      disableModelInvocation: true,
      getPrompt: async () => 'nope',
    },
    {
      type: 'local',
      name: 'clear-me',
      description: 'A local command — not reachable via this tool',
      source: 'builtin',
      call: async () => ({ kind: 'skip' as const }),
    },
    {
      type: 'prompt',
      name: 'gated',
      description: 'Feature-gated prompt command',
      source: 'builtin',
      isEnabled: () => false,
      getPrompt: async () => 'disabled',
    },
  ],
}))
vi.mock('../slash-commands/loaders/skills', () => ({
  loadSkillCommands: () => [],
  getSkillLoadErrors: () => [],
  warmSkillsCache: async () => {},
}))
vi.mock('../slash-commands/loaders/plugins', () => ({
  loadPluginCommands: () => [],
}))

import { __resetRegistryCacheForTests } from '../slash-commands/registry'
import { slashCommandTool } from './slash-command-tool'

beforeEach(() => __resetRegistryCacheForTests())
afterEach(() => __resetRegistryCacheForTests())

function makeCtx() {
  return {
    sessionId: 'sess-1',
    signal: new AbortController().signal,
  }
}

describe('slashCommandTool metadata', () => {
  it('is registered with a safe trust level and info card mode', () => {
    expect(slashCommandTool.trustLevel).toBe('safe')
    expect(slashCommandTool.cardMode).toBe('info')
    expect(slashCommandTool.planModeAllowed).toBe(true)
  })

  it('declares name + required args schema', () => {
    expect(slashCommandTool.name).toBe('invoke_slash_command')
    expect(slashCommandTool.inputSchema.required).toEqual(['name'])
    expect(slashCommandTool.inputSchema.properties.name).toBeDefined()
    expect(slashCommandTool.inputSchema.properties.args).toBeDefined()
  })
})

describe('slashCommandTool execute', () => {
  it('expands a prompt-type command and returns the scaffold', async () => {
    const result = await slashCommandTool.execute(
      { name: 'expand-me', args: 'topic-x' },
      makeCtx(),
    )
    expect(result).toEqual({ name: 'expand-me', expanded: 'expanded(topic-x)' })
  })

  it('defaults args to empty string when omitted', async () => {
    const result = await slashCommandTool.execute(
      { name: 'expand-me' },
      makeCtx(),
    )
    expect(result.expanded).toBe('expanded()')
  })

  it('refuses a local-type command', async () => {
    await expect(
      slashCommandTool.execute({ name: 'clear-me' }, makeCtx()),
    ).rejects.toThrow(/only 'prompt' commands/)
  })

  it('refuses commands with disableModelInvocation', async () => {
    await expect(
      slashCommandTool.execute({ name: 'model-hidden' }, makeCtx()),
    ).rejects.toThrow(/not available to the model/)
  })

  it('refuses disabled commands', async () => {
    await expect(
      slashCommandTool.execute({ name: 'gated' }, makeCtx()),
    ).rejects.toThrow(/disabled in this build/)
  })

  it('returns a clear error for unknown names', async () => {
    await expect(
      slashCommandTool.execute({ name: 'nonexistent' }, makeCtx()),
    ).rejects.toThrow(/Unknown slash command/)
  })

  it('requires a name input', async () => {
    await expect(
      // @ts-expect-error — deliberately missing required field
      slashCommandTool.execute({}, makeCtx()),
    ).rejects.toThrow(/name is required/)
  })
})
