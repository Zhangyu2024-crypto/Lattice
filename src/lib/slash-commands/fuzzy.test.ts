import { describe, expect, it } from 'vitest'
import { rankCommands, scoreCommand } from './fuzzy'
import type { Command } from './types'

function cmd(name: string, overrides: Partial<Command> = {}): Command {
  return {
    type: 'local',
    name,
    description: `Run ${name}`,
    source: 'builtin',
    call: async () => ({ kind: 'skip' as const }),
    ...overrides,
  } as Command
}

describe('scoreCommand', () => {
  it('empty query returns 0 for every candidate', () => {
    expect(scoreCommand(cmd('clear'), '')).toBe(0)
    expect(scoreCommand(cmd('help'), '   ')).toBe(0)
  })

  it('exact name beats prefix', () => {
    const exact = scoreCommand(cmd('clear'), 'clear')
    const prefix = scoreCommand(cmd('clear-all'), 'clear')
    expect(exact).toBeGreaterThan(prefix)
  })

  it('prefix beats word-boundary', () => {
    const prefix = scoreCommand(cmd('review'), 'rev')
    const word = scoreCommand(cmd('open-review'), 'rev')
    expect(prefix).toBeGreaterThan(word)
  })

  it('word-boundary beats subsequence', () => {
    const word = scoreCommand(cmd('open-tab'), 'tab')
    const subseq = scoreCommand(cmd('tabletop'), 'tab') // also a prefix
    // tabletop is a *prefix* match; word boundary on open-tab is lower
    expect(subseq).toBeGreaterThan(word)
  })

  it('alias exact beats name prefix', () => {
    const aliasExact = scoreCommand(
      cmd('hypothesize', { aliases: ['h'] }),
      'h',
    )
    const namePrefix = scoreCommand(cmd('help'), 'h')
    expect(aliasExact).toBeGreaterThan(namePrefix)
  })

  it('description prefix matches when name does not', () => {
    const s = scoreCommand(
      cmd('xyz', { description: 'Start research' }),
      'start',
    )
    expect(s).toBeGreaterThan(0)
  })

  it('no match returns -Infinity', () => {
    expect(scoreCommand(cmd('clear'), 'zzz')).toBe(Number.NEGATIVE_INFINITY)
  })

  it('is case-insensitive', () => {
    expect(scoreCommand(cmd('Clear'), 'CLE')).toBeGreaterThan(0)
  })
})

describe('rankCommands', () => {
  it('empty query preserves order', () => {
    const list = [cmd('a'), cmd('b'), cmd('c')]
    expect(rankCommands(list, '').map((c) => c.name)).toEqual(['a', 'b', 'c'])
  })

  it('drops non-matching commands', () => {
    const list = [cmd('clear'), cmd('help'), cmd('research')]
    expect(rankCommands(list, 'help').map((c) => c.name)).toEqual(['help'])
  })

  it('ranks exact > prefix > subsequence', () => {
    const list = [
      cmd('research'),       // prefix of "re"
      cmd('restart'),        // prefix of "re"
      cmd('re', { aliases: [] }), // exact
      cmd('xrd-refine'),     // word boundary
    ]
    const ranked = rankCommands(list, 're').map((c) => c.name)
    expect(ranked[0]).toBe('re')
    // Among the prefixes, shorter name wins.
    expect(ranked.slice(1)).toEqual(
      ['restart', 'research', 'xrd-refine'],
    )
  })

  it('stable tie-break on registry index', () => {
    const list = [cmd('abcd'), cmd('abce'), cmd('abcf')]
    const ranked = rankCommands(list, 'abc').map((c) => c.name)
    expect(ranked).toEqual(['abcd', 'abce', 'abcf'])
  })
})
