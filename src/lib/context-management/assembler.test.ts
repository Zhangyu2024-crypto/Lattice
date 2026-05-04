import { describe, expect, it } from 'vitest'
import type { LlmMessagePayload } from '../../types/electron'
import { assembleLlmContext } from './assembler'

const tinyTool = {
  name: 'tiny_tool',
  description: 'A tiny test tool.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      q: { type: 'string', description: 'query' },
    },
  },
}

const largeTool = {
  name: 'large_tool',
  description: 'x'.repeat(1600),
  inputSchema: {
    type: 'object' as const,
    properties: {
      q: { type: 'string', description: 'y'.repeat(1600) },
    },
  },
}

describe('assembleLlmContext', () => {
  it('accounts for tool schema tokens when trimming history', () => {
    const sourceMessages: LlmMessagePayload[] = [
      { role: 'user', content: 'old '.repeat(2000) },
      { role: 'assistant', content: 'middle' },
      { role: 'user', content: 'recent' },
    ]

    const withoutTools = assembleLlmContext({
      mode: 'agent',
      systemPrompt: 'system',
      contextBlocks: [],
      sourceMessages,
      requestCeiling: 1300,
      safetyMargin: 0,
    })
    const withTools = assembleLlmContext({
      mode: 'agent',
      systemPrompt: 'system',
      contextBlocks: [],
      sourceMessages,
      tools: [largeTool],
      requestCeiling: 1300,
      safetyMargin: 0,
    })

    expect(withoutTools.budget.toolSchemaTokens).toBe(0)
    expect(withTools.budget.toolSchemaTokens).toBeGreaterThan(0)
    expect(withTools.budget.historyBudget).toBeLessThan(
      withoutTools.budget.historyBudget,
    )
    expect(withTools.budget.trimmedMessageCount).toBeLessThanOrEqual(
      withoutTools.budget.trimmedMessageCount,
    )
  })

  it('does not expose tool schemas in dialog mode', () => {
    const assembled = assembleLlmContext({
      mode: 'dialog',
      systemPrompt: '',
      contextBlocks: [],
      sourceMessages: [{ role: 'user', content: 'hello' }],
      tools: [tinyTool],
      requestCeiling: 1000,
      safetyMargin: 0,
    })

    expect(assembled.toolsForInvoke).toBeUndefined()
    expect(assembled.budget.toolSchemaTokens).toBe(0)
  })

  it('keeps the most recent tool_use/tool_result pair atomically', () => {
    const sourceMessages: LlmMessagePayload[] = [
      { role: 'user', content: 'old '.repeat(1000) },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'tiny_tool',
            input: { q: 'recent' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_1',
            content: JSON.stringify({ ok: true }),
          },
        ],
      },
    ]

    const assembled = assembleLlmContext({
      mode: 'agent',
      systemPrompt: '',
      contextBlocks: [],
      sourceMessages,
      requestCeiling: 20,
      safetyMargin: 0,
    })

    expect(assembled.messages).toHaveLength(2)
    expect(assembled.messages[0].role).toBe('assistant')
    expect(assembled.messages[1].role).toBe('user')
  })
})
