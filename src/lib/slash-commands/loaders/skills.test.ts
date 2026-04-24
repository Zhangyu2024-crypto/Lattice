import { describe, expect, it } from 'vitest'
import { compileSkills } from './skills'
import { isPromptCommand } from '../types'

function buildCtx() {
  return {
    sessionId: 'sess-1',
    transcript: [],
    signal: new AbortController().signal,
    caller: 'user' as const,
  }
}

describe('compileSkills', () => {
  it('produces a PromptCommand per well-formed file', () => {
    const cmds = compileSkills([
      {
        fileName: 'summarize.md',
        source:
          '---\n' +
          'name: summarize\n' +
          'description: Summarize the focused artifact\n' +
          'argumentHint: "<max-words>"\n' +
          '---\n' +
          'Summarize the focused artifact in {args} words or fewer.\n',
      },
    ])
    expect(cmds).toHaveLength(1)
    const cmd = cmds[0]
    expect(isPromptCommand(cmd)).toBe(true)
    expect(cmd.name).toBe('summarize')
    expect(cmd.description).toBe('Summarize the focused artifact')
    expect(cmd.source).toBe('skill')
    expect(cmd.argumentHint).toBe('<max-words>')
  })

  it('substitutes {args} in the body', async () => {
    const cmds = compileSkills([
      {
        fileName: 'ask.md',
        source:
          '---\nname: ask\ndescription: q\n---\nQuestion: {args}\n',
      },
    ])
    if (!isPromptCommand(cmds[0])) throw new Error('expected prompt command')
    const expanded = await cmds[0].getPrompt('why is the sky blue', buildCtx())
    expect(expanded).toBe('Question: why is the sky blue\n')
  })

  it('appends args on a blank line when {args} is absent', async () => {
    const cmds = compileSkills([
      {
        fileName: 'tail.md',
        source: '---\nname: tail\ndescription: x\n---\nHeader body.',
      },
    ])
    if (!isPromptCommand(cmds[0])) throw new Error('expected prompt command')
    const expanded = await cmds[0].getPrompt('extra', buildCtx())
    expect(expanded).toBe('Header body.\n\nextra')
  })

  it('leaves the body unchanged when args are empty', async () => {
    const cmds = compileSkills([
      {
        fileName: 'plain.md',
        source: '---\nname: plain\ndescription: x\n---\nplain body',
      },
    ])
    if (!isPromptCommand(cmds[0])) throw new Error('expected prompt command')
    const expanded = await cmds[0].getPrompt('', buildCtx())
    expect(expanded).toBe('plain body')
  })

  it('lowercases the name and falls back to the filename', () => {
    const cmds = compileSkills([
      {
        fileName: 'SHOUTY.md',
        source: '---\ndescription: x\n---\nbody',
      },
      {
        fileName: 'other.md',
        source: '---\nname: Named\ndescription: x\n---\nbody',
      },
    ])
    expect(cmds.map((c) => c.name)).toEqual(['shouty', 'named'])
  })

  it('drops files whose name has whitespace', () => {
    const cmds = compileSkills([
      {
        fileName: 'bad.md',
        source: '---\nname: has space\ndescription: x\n---\nbody',
      },
    ])
    expect(cmds).toHaveLength(0)
  })

  it('honours aliases and disableModelInvocation', () => {
    const cmds = compileSkills([
      {
        fileName: 'hidden.md',
        source:
          '---\n' +
          'name: hidden\n' +
          'description: x\n' +
          'aliases: [h, hide]\n' +
          'disableModelInvocation: true\n' +
          '---\n' +
          'body',
      },
    ])
    expect(cmds[0].aliases).toEqual(['h', 'hide'])
    expect(cmds[0].disableModelInvocation).toBe(true)
  })

  it('uses a default description when none is supplied', () => {
    const cmds = compileSkills([
      {
        fileName: 'bare.md',
        source: '---\nname: bare\n---\nbody',
      },
    ])
    expect(cmds[0].description).toBe('User skill')
  })
})
