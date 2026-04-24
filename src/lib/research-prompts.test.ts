import { describe, it, expect } from 'vitest'
import {
  buildInlineResearchScaffold,
  parseResearchCommand,
} from './research-prompts'

describe('parseResearchCommand', () => {
  it('recognizes @research <topic>', () => {
    expect(parseResearchCommand('@research 中欧关系')).toEqual({
      topic: '中欧关系',
    })
  })

  it('is case insensitive', () => {
    expect(parseResearchCommand('@ReSeArCh 中欧关系')).toEqual({
      topic: '中欧关系',
    })
  })

  it('tolerates leading whitespace', () => {
    expect(parseResearchCommand('   @research 中欧关系')?.topic).toBe('中欧关系')
  })

  it('returns null when no topic is given', () => {
    expect(parseResearchCommand('@research')).toBeNull()
    expect(parseResearchCommand('@research   ')).toBeNull()
  })

  it('returns null for non-command text', () => {
    expect(parseResearchCommand('hello world')).toBeNull()
    expect(parseResearchCommand('research 中欧关系')).toBeNull()
    expect(parseResearchCommand('@foo bar')).toBeNull()
    expect(parseResearchCommand('@brief foo')).toBeNull()
    expect(parseResearchCommand('@survey foo')).toBeNull()
  })
})

describe('buildInlineResearchScaffold', () => {
  it('bakes the topic into the scaffold and includes both mode options', () => {
    const s = buildInlineResearchScaffold('perovskite solar cells')
    expect(s).toContain('perovskite solar cells')
    expect(s).toContain("mode='research'")
    expect(s).toContain("mode='survey'")
    expect(s).toContain('research_plan_outline')
    expect(s).toContain('research_finalize_report')
  })
})
