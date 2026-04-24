// Lock-in: /research <topic> must expand to the exact same bytes as the
// existing @research inline command so the migration is behaviour-preserving.
import { describe, expect, it } from 'vitest'
import { researchCommand } from './research'
import { buildInlineResearchScaffold } from '../../research-prompts'

function ctx() {
  return {
    sessionId: 'sess-1',
    transcript: [],
    signal: new AbortController().signal,
    caller: 'user' as const,
  }
}

describe('researchCommand', () => {
  it('matches buildInlineResearchScaffold byte-for-byte', async () => {
    const expanded = await researchCommand.getPrompt('BaTiO3 ferroelectrics', ctx())
    expect(expanded).toBe(buildInlineResearchScaffold('BaTiO3 ferroelectrics'))
  })

  it('passes empty args through unchanged (scaffold handles the fallback)', async () => {
    const expanded = await researchCommand.getPrompt('', ctx())
    expect(expanded).toBe(buildInlineResearchScaffold(''))
  })

  it('declares a 12-iteration ceiling and a paletteGroup', () => {
    expect(researchCommand.maxIterations).toBe(12)
    expect(researchCommand.paletteGroup).toBeTruthy()
  })
})
