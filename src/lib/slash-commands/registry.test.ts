import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The registry pulls BUILTIN_COMMANDS at module load. We mock both source
// modules so the tests exercise the merge/lookup logic in isolation from
// whatever the real builtin set happens to contain.
vi.mock('./builtin', () => ({
  BUILTIN_COMMANDS: [
    {
      type: 'local',
      name: 'clear',
      description: 'Clear screen',
      source: 'builtin',
      call: async () => ({ kind: 'skip' }),
    },
    {
      type: 'local',
      name: 'help',
      description: 'Show help',
      source: 'builtin',
      aliases: ['h', '?'],
      paletteGroup: 'Help',
      call: async () => ({ kind: 'text', text: 'help' }),
    },
    {
      type: 'prompt',
      name: 'hidden',
      description: 'Hidden from users',
      source: 'builtin',
      userInvocable: false,
      getPrompt: async () => 'x',
    },
    {
      type: 'prompt',
      name: 'model-only',
      description: 'No model invocation',
      source: 'builtin',
      disableModelInvocation: true,
      getPrompt: async () => 'y',
    },
    {
      type: 'local',
      name: 'toggled',
      description: 'Gated by feature flag',
      source: 'builtin',
      isEnabled: () => false,
      call: async () => ({ kind: 'skip' }),
    },
  ],
}))
vi.mock('./loaders/skills', () => ({
  loadSkillCommands: () => [
    {
      type: 'prompt',
      name: 'skill-only',
      description: 'From a skill',
      source: 'skill',
      getPrompt: async () => 'skill',
    },
    // Collides with a builtin — builtin must win.
    {
      type: 'prompt',
      name: 'clear',
      description: 'Skill override attempt',
      source: 'skill',
      getPrompt: async () => 'nope',
    },
  ],
}))
vi.mock('./loaders/plugins', () => ({
  loadPluginCommands: () => [],
}))

// Import after the mocks are in place.
import {
  __resetRegistryCacheForTests,
  findCommand,
  listCommands,
  loadAllCommands,
} from './registry'

beforeEach(() => __resetRegistryCacheForTests())
afterEach(() => __resetRegistryCacheForTests())

describe('registry', () => {
  it('merges builtin + skill + plugin sources', () => {
    const all = loadAllCommands()
    const names = all.map((c) => c.name).sort()
    expect(names).toEqual(
      ['clear', 'help', 'hidden', 'model-only', 'skill-only', 'toggled'].sort(),
    )
  })

  it('skill wins over builtin on name collisions (plugin > skill > builtin)', () => {
    // The mocked skill loader declares its own `clear` — with the v2
    // precedence flip (plugin > skill > builtin) the skill must win.
    const clear = findCommand('clear')
    expect(clear?.source).toBe('skill')
  })

  it('memoizes across repeated calls', () => {
    const a = loadAllCommands()
    const b = loadAllCommands()
    expect(a).toBe(b)
  })

  it('findCommand is case-insensitive and matches aliases', () => {
    expect(findCommand('CLEAR')?.name).toBe('clear')
    expect(findCommand('h')?.name).toBe('help')
    expect(findCommand('?')?.name).toBe('help')
    expect(findCommand('nope')).toBeUndefined()
  })
})

describe('listCommands filters', () => {
  it('userInvocableOnly drops hidden commands', () => {
    const names = listCommands({ userInvocableOnly: true }).map((c) => c.name)
    expect(names).not.toContain('hidden')
    expect(names).toContain('clear')
  })

  it('modelInvocableOnly drops disableModelInvocation commands', () => {
    const names = listCommands({ modelInvocableOnly: true }).map((c) => c.name)
    expect(names).not.toContain('model-only')
    expect(names).toContain('clear')
  })

  it('enabledOnly drops isEnabled() === false commands', () => {
    const names = listCommands({ enabledOnly: true }).map((c) => c.name)
    expect(names).not.toContain('toggled')
    expect(names).toContain('clear')
  })

  it('paletteOnly keeps only commands with paletteGroup', () => {
    const names = listCommands({ paletteOnly: true }).map((c) => c.name)
    expect(names).toEqual(['help'])
  })
})
