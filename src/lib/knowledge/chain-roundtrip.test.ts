// End-to-end round-trip test: LLM response → auto-extract → insertChains
// → chainsByPaper → the exact shape that ChainCard renders.
//
// Purpose: isolate where chain "detail" (value / unit / context_text /
// confidence) is lost, if anywhere.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'
import { useLogStore } from '../../stores/log-store'

const readPaperMock = vi.fn()
const sendLlmChatMock = vi.fn()

// In-memory shim for localProKnowledge — captures writes and serves reads
// so we can observe exactly what auto-extract persists.
interface StoredChain {
  paper_id: number
  chain_id: number
  nodes: Array<{
    ordinal: number
    role: string
    name: string
    value?: string
    value_numeric?: number
    unit?: string
    metadata?: Record<string, unknown>
  }>
  confidence?: number
  domain_type?: string
  chain_type?: string
  context_text?: string
  context_section?: string
}
const stored: StoredChain[] = []
let nextChainId = 1000
const saveChainsMock = vi.fn(async (req: {
  paper_id: number
  chains: Array<Omit<StoredChain, 'paper_id' | 'chain_id'>>
}) => {
  const ids: number[] = []
  for (const c of req.chains) {
    const cid = nextChainId++
    stored.push({ paper_id: req.paper_id, chain_id: cid, ...c })
    ids.push(cid)
  }
  return {
    success: true as const,
    extraction_id: 1,
    chain_ids: ids,
    count: ids.length,
  }
})

const chainsByPaperMock = vi.fn(async (paperId: number) => {
  return stored
    .filter((c) => c.paper_id === paperId)
    .map((c) => ({
      chain_id: c.chain_id,
      extraction_id: 1,
      paper_id: paperId,
      paper_title: 'Test paper',
      domain_type: c.domain_type,
      chain_type: c.chain_type,
      confidence: c.confidence ?? 0.5,
      context_section: c.context_section,
      context_text: c.context_text,
      nodes: c.nodes,
    }))
})

vi.mock('../local-pro-library', () => ({
  localProLibrary: {
    readPaper: (...args: unknown[]) => readPaperMock(...args),
    listPapers: vi.fn(),
    ready: true,
  },
}))

vi.mock('../local-pro-knowledge', () => ({
  localProKnowledge: {
    saveChains: (...args: unknown[]) => saveChainsMock(args[0] as never),
    chainsByPaper: (...args: unknown[]) => chainsByPaperMock(args[0] as number),
  },
}))

vi.mock('../llm-chat', () => ({
  sendLlmChat: (...args: unknown[]) => sendLlmChatMock(...args),
  getUnresolvedModelMessage: () => 'No model',
}))

const { extractPaperToKnowledge } = await import('./auto-extract')
const { localProKnowledge } = await import('../local-pro-knowledge')
const { default: ChainCard } = await import('../../components/common/ChainCard')

const PAPER_FULL_TEXT = `
Abstract
We study Bi2Te3 thermoelectrics.

Introduction
Background on thermoelectrics.

Experimental
Samples synthesised by hot pressing at 723 K for 30 min.

Results
The sample exhibits ZT = 0.8 at 400 K.

Conclusion
Done.
`.trim()

const GOOD_READ = {
  success: true as const,
  full_text: PAPER_FULL_TEXT,
  sections: [{ title: 'Page 1', level: 1, content: PAPER_FULL_TEXT }],
  page_count: 1,
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('chain round-trip (LLM → save → read → render)', () => {
  beforeEach(() => {
    useLogStore.setState({ entries: [], unreadCount: 0 })
    readPaperMock.mockReset()
    sendLlmChatMock.mockReset()
    saveChainsMock.mockClear()
    chainsByPaperMock.mockClear()
    stored.length = 0
    nextChainId = 1000
  })

  it('preserves all fields: value, unit, context_text, context_section, confidence', async () => {
    readPaperMock.mockResolvedValueOnce(GOOD_READ)

    // PageIndex selection picks the "Results" section (id 0003 in the
    // heuristic section split).
    sendLlmChatMock
      .mockResolvedValueOnce({
        success: true,
        content: JSON.stringify({ data_nodes: ['0003'] }),
        durationMs: 100,
      })
      // Batch extraction returns a fully-populated chain.
      .mockResolvedValueOnce({
        success: true,
        content: JSON.stringify({
          chains: [
            {
              domain_type: 'materials',
              context_text:
                'The sample exhibits ZT = 0.8 at 400 K after hot pressing at 723 K.',
              context_section: 'Results',
              confidence: 0.88,
              nodes: [
                {
                  role: 'system',
                  name: 'Bi2Te3',
                  value: null,
                  unit: null,
                },
                {
                  role: 'process',
                  name: 'hot pressing',
                  value: '723',
                  unit: 'K',
                },
                {
                  role: 'state',
                  name: 'crystalline phase',
                  value: 'R-3m',
                  unit: null,
                },
                {
                  role: 'measurement',
                  name: 'ZT',
                  value: '0.8',
                  unit: null,
                },
              ],
            },
          ],
        }),
        durationMs: 500,
      })

    const result = await extractPaperToKnowledge(777)
    expect(result.success).toBe(true)
    expect(result.chainCount).toBe(1)

    // ── What did auto-extract hand to saveChains? ─────────────────
    expect(saveChainsMock).toHaveBeenCalledTimes(1)
    const saved = saveChainsMock.mock.calls[0][0]
    expect(saved.paper_id).toBe(777)
    expect(saved.chains).toHaveLength(1)
    const c0 = saved.chains[0]
    expect(c0.domain_type).toBe('materials')
    expect(c0.confidence).toBe(0.88)
    expect(c0.context_text).toContain('ZT = 0.8')
    expect(c0.context_section).toBe('Results')
    expect(c0.nodes).toHaveLength(4)

    // Each node keeps role / name / value / unit.
    const process = c0.nodes.find((n) => n.role === 'process')
    expect(process?.name).toBe('hot pressing')
    expect(process?.value).toBe('723')
    expect(process?.unit).toBe('K')
    expect(process?.value_numeric).toBe(723)

    const meas = c0.nodes.find((n) => n.role === 'measurement')
    expect(meas?.value).toBe('0.8')
    expect(meas?.value_numeric).toBe(0.8)

    // ── Read back what ChainCard would receive ────────────────────
    const back = await localProKnowledge.chainsByPaper(777)
    expect(back).toHaveLength(1)
    const m = back[0]
    expect(m.context_text).toContain('ZT = 0.8')
    expect(m.context_section).toBe('Results')
    expect(m.confidence).toBe(0.88)
    const measM = m.nodes.find((n) => n.role === 'measurement')!
    expect(measM.value).toBe('0.8')

    // ── Render ChainCard and verify the DOM contains the details ──
    const { container } = render(
      React.createElement(ChainCard, { chain: m }),
    )
    const html = container.innerHTML
    // Role labels
    expect(html).toContain('System')
    expect(html).toContain('Process')
    expect(html).toContain('State')
    // Names
    expect(html).toContain('Bi2Te3')
    expect(html).toContain('hot pressing')
    // Value + unit formatted together
    expect(html).toContain('723 K')
    expect(html).toContain('0.8')
    // Context quote + section tag + confidence percentage
    expect(html).toContain('ZT = 0.8')
    expect(html).toContain('Results')
    expect(html).toContain('88%')
  })

  it('keeps shallow chains (no values) — better to show something than nothing', async () => {
    readPaperMock.mockResolvedValueOnce(GOOD_READ)

    sendLlmChatMock
      .mockResolvedValueOnce({
        success: true,
        content: JSON.stringify({ data_nodes: ['0003'] }),
        durationMs: 100,
      })
      .mockResolvedValueOnce({
        success: true,
        content: JSON.stringify({
          chains: [
            {
              nodes: [
                { role: 'system', name: 'Bi2Te3' },
                { role: 'measurement', name: 'ZT' },
              ],
            },
          ],
        }),
        durationMs: 500,
      })

    const result = await extractPaperToKnowledge(888)
    // Shallow chain is kept — at least the user sees "Bi2Te3 → ZT"
    // rather than nothing. A follow-up info log flags the low-value
    // ratio so the user knows the LLM was being lazy.
    expect(result.chainCount).toBe(1)

    const back = await localProKnowledge.chainsByPaper(888)
    expect(back).toHaveLength(1)
    expect(back[0].nodes[0].name).toBe('Bi2Te3')
    expect(back[0].nodes[1].name).toBe('ZT')
  })
})
