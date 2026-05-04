import { describe, expect, it } from 'vitest'
import { buildContextUsageReport } from './report'

describe('buildContextUsageReport', () => {
  it('reports request categories and dropped history', () => {
    const report = buildContextUsageReport({
      mode: 'agent',
      systemPrompt: 'system prompt',
      contextBlocks: [
        { refKey: 'a1', body: 'mentioned artifact', tokenEstimate: 4 },
      ],
      sourceMessages: [
        { role: 'user', content: 'old '.repeat(1000) },
        { role: 'assistant', content: 'recent answer' },
        { role: 'user', content: 'latest question' },
      ],
      tools: [
        {
          name: 'ctx_tool',
          description: 'tool description',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
      requestCeiling: 80,
      safetyMargin: 8,
    })

    expect(report.mode).toBe('agent')
    expect(report.categories.map((c) => c.name)).toEqual([
      'System prompt',
      'Mention context',
      'Tool schemas',
      'Included history',
      'Safety margin',
    ])
    expect(
      report.categories.find((c) => c.name === 'Tool schemas')?.tokens,
    ).toBeGreaterThan(0)
    expect(report.messageCounts.source).toBe(3)
    expect(report.messageCounts.dropped).toBeGreaterThanOrEqual(1)
    expect(report.percentUsed).toBeGreaterThan(0)
  })
})
