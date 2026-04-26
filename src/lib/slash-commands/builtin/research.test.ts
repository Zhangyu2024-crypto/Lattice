// Lock-in: /research <topic> expands through the shared research scaffold.
import { describe, expect, it } from 'vitest'
import {
  RESEARCH_COMMAND_MAX_ITERATIONS,
  researchCommand,
} from './research'
import { buildResearchScaffold } from '../../research-prompts'

function ctx() {
  return {
    sessionId: 'sess-1',
    transcript: [],
    signal: new AbortController().signal,
    caller: 'user' as const,
  }
}

describe('researchCommand', () => {
  it('matches buildResearchScaffold byte-for-byte', async () => {
    const expanded = await researchCommand.getPrompt('BaTiO3 ferroelectrics', ctx())
    expect(expanded).toBe(buildResearchScaffold('BaTiO3 ferroelectrics'))
  })

  it('passes empty args through unchanged (scaffold handles the fallback)', async () => {
    const expanded = await researchCommand.getPrompt('', ctx())
    expect(expanded).toBe(buildResearchScaffold(''))
  })

  it('declares a research-sized iteration ceiling and a paletteGroup', () => {
    expect(researchCommand.maxIterations).toBe(RESEARCH_COMMAND_MAX_ITERATIONS)
    expect(researchCommand.maxIterations).toBeGreaterThanOrEqual(60)
    expect(researchCommand.paletteGroup).toBeTruthy()
  })
})
