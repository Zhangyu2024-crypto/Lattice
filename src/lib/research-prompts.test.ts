import { describe, it, expect } from 'vitest'
import { buildResearchScaffold } from './research-prompts'

describe('buildResearchScaffold', () => {
  it('bakes the topic into the scaffold and includes both mode options', () => {
    const s = buildResearchScaffold('perovskite solar cells')
    expect(s).toContain('perovskite solar cells')
    expect(s).toContain("mode='research'")
    expect(s).toContain("mode='survey'")
    expect(s).toContain('research_plan_outline')
    expect(s).toContain('research_continue_report')
  })
})
