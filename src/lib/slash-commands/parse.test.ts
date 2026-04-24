import { describe, expect, it } from 'vitest'
import { parseSlashCommand } from './parse'

describe('parseSlashCommand', () => {
  it('returns null for empty / non-slash input', () => {
    expect(parseSlashCommand('')).toBeNull()
    expect(parseSlashCommand('hello')).toBeNull()
    expect(parseSlashCommand(' /clear')).toBeNull()
    expect(parseSlashCommand('\t/clear')).toBeNull()
  })

  it('rejects bare slash and double slash', () => {
    expect(parseSlashCommand('/')).toBeNull()
    expect(parseSlashCommand('//')).toBeNull()
    expect(parseSlashCommand('/ foo')).toBeNull()
  })

  it('parses a bare command with no args', () => {
    expect(parseSlashCommand('/clear')).toEqual({ name: 'clear', args: '' })
  })

  it('parses command and args', () => {
    expect(parseSlashCommand('/research superconductors')).toEqual({
      name: 'research',
      args: 'superconductors',
    })
  })

  it('lowercases the command name', () => {
    expect(parseSlashCommand('/ReSeArCh topic')).toEqual({
      name: 'research',
      args: 'topic',
    })
  })

  it('preserves case and inner whitespace of args', () => {
    expect(parseSlashCommand('/research  BaTiO3 ferroelectrics  ')).toEqual({
      name: 'research',
      args: 'BaTiO3 ferroelectrics',
    })
  })

  it('accepts a trailing argument that spans multiple tokens', () => {
    const parsed = parseSlashCommand('/artifact xrd-2024-01 with notes')
    expect(parsed).toEqual({
      name: 'artifact',
      args: 'xrd-2024-01 with notes',
    })
  })
})
