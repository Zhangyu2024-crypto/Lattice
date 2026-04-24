// Integration test for the PageIndex chain extraction pipeline.
// Mocks localProLibrary, localProKnowledge, and sendLlmChat; asserts that
// each pipeline stage writes the expected log entries into the log store.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLogStore, type LogEntry } from '../../stores/log-store'

// ─── Mocks ──────────────────────────────────────────────────────────

const readPaperMock = vi.fn()
const saveChainsMock = vi.fn()
const sendLlmChatMock = vi.fn()

vi.mock('../local-pro-library', () => ({
  localProLibrary: {
    readPaper: (...args: unknown[]) => readPaperMock(...args),
    listPapers: vi.fn(),
    ready: true,
  },
}))

vi.mock('../local-pro-knowledge', () => ({
  localProKnowledge: {
    saveChains: (...args: unknown[]) => saveChainsMock(...args),
  },
}))

vi.mock('../llm-chat', () => ({
  sendLlmChat: (...args: unknown[]) => sendLlmChatMock(...args),
  getUnresolvedModelMessage: () => 'No model',
}))

// Import AFTER mocks are registered.
const { extractPaperToKnowledge } = await import('./auto-extract')

// ─── Helpers ────────────────────────────────────────────────────────

function entriesBySource(entries: LogEntry[], source: string): LogEntry[] {
  return entries.filter((e) => e.source === source)
}

function stageOf(e: LogEntry): string {
  return (e.detail?.stage as string) || '(none)'
}

// A plausible paper with real-looking section headings so the heuristic
// parser can find >= 3 headings.
const PAPER_FULL_TEXT = `
Abstract

This paper studies thermoelectric properties of Bi2Te3.

Introduction

Thermoelectric materials are important for energy conversion.
Recent work on Bi2Te3 shows promising ZT values.

Experimental

Samples of Bi2Te3 were synthesised by hot pressing at 723 K
for 30 minutes under 80 MPa. Powder X-ray diffraction was
performed on a Bruker D8 using Cu Kα radiation.

Results

The as-prepared Bi2Te3 sample showed a hexagonal phase
(space group R-3m) with lattice parameters a=4.38 Å, c=30.49 Å.
The electrical conductivity reached 850 S/cm at 300 K and the
Seebeck coefficient was -180 μV/K at 400 K, yielding ZT = 0.8.

Conclusion

We demonstrate that hot-pressed Bi2Te3 achieves ZT of 0.8.
`.trim()

const GOOD_READ = {
  success: true,
  full_text: PAPER_FULL_TEXT,
  sections: [
    { title: 'Page 1', level: 1, content: PAPER_FULL_TEXT },
  ],
  page_count: 1,
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('extractPaperToKnowledge', () => {
  beforeEach(() => {
    useLogStore.setState({ entries: [], unreadCount: 0 })
    readPaperMock.mockReset()
    saveChainsMock.mockReset()
    sendLlmChatMock.mockReset()
    // Default: saveChains accepts whatever was handed to it and reports
    // back `accepted = count`. Individual tests override via
    // `mockResolvedValueOnce` when they need to shape the response
    // (e.g. simulate the v2 quality gate rejecting everything).
    saveChainsMock.mockImplementation(async (req: {
      chains: unknown[]
      quality_floor?: string
    }) => {
      // Real insertChains demotes accepted → diagnostic when
      // quality_floor='diagnostic' is set. Mock the same so tests that
      // exercise the heuristic fallback see accepted=0.
      const demoted = req.quality_floor === 'diagnostic'
      return {
        success: true as const,
        extraction_id: 1,
        chain_ids: req.chains.map((_, i) => i + 1),
        count: req.chains.length,
        accepted: demoted ? 0 : req.chains.length,
        diagnostic: demoted ? req.chains.length : 0,
        rejected: 0,
        rejected_details: [],
      }
    })
  })

  it('logs a start checkpoint', async () => {
    readPaperMock.mockResolvedValueOnce({
      success: false,
      error: 'fake PDF error',
    })
    await extractPaperToKnowledge(42)

    const entries = useLogStore.getState().entries
    const starts = entries.filter((e) =>
      e.message.includes('Chain extraction starting'),
    )
    expect(starts).toHaveLength(1)
    expect(starts[0].source).toBe('knowledge')
    expect(starts[0].detail?.paperId).toBe(42)
  })

  it('logs PDF read failure with error detail', async () => {
    readPaperMock.mockResolvedValueOnce({
      success: false,
      error: 'PDF missing on disk',
    })
    const result = await extractPaperToKnowledge(7)

    expect(result).toEqual({
      paperId: 7,
      success: false,
      chainCount: 0,
      stage: 'read',
      error: 'PDF missing on disk',
    })

    const entries = useLogStore.getState().entries
    const failures = entries.filter((e) => e.message === 'PDF read failed')
    expect(failures).toHaveLength(1)
    expect(failures[0].level).toBe('error')
    expect(failures[0].detail?.error).toBe('PDF missing on disk')
  })

  it('warns when LLM returns zero chains (end-to-end)', async () => {
    readPaperMock.mockResolvedValueOnce(GOOD_READ)
    // Pretend LLM never finds data nodes AND the fallback chains extractor
    // also returns no valid chains. Both calls succeed structurally but
    // return `{data_nodes: []}` / `{chains: []}`.
    sendLlmChatMock.mockResolvedValue({
      success: true,
      content: JSON.stringify({ data_nodes: [] }),
      durationMs: 120,
      inputTokens: 0,
      outputTokens: 0,
    })

    const result = await extractPaperToKnowledge(99)

    // chainCount here is the v2 "accepted" count. The heuristic fallback
    // (triggered when the LLM can't produce structured JSON) is always
    // floored to `quality='diagnostic'` by auto-extract, so accepted
    // stays at 0 even though diagnostic chains may have been written.
    expect(result.chainCount).toBe(0)
    expect(result.success).toBe(true)

    const knowledgeEntries = entriesBySource(
      useLogStore.getState().entries,
      'knowledge',
    )
    const stages = knowledgeEntries.map(stageOf)
    // Should see: start, read, resolve_sections, select_data_nodes,
    // extract_chains_from_text (fallback), final warn.
    expect(stages).toContain('start')
    expect(stages).toContain('read')
    expect(stages).toContain('resolve_sections')
    expect(stages).toContain('select_data_nodes')

    // The zero-chain warning has either 'extract_chains_from_text' stage
    // (from llm-extract) or 'extract' stage (from auto-extract top).
    const zeroWarns = knowledgeEntries.filter(
      (e) =>
        e.level === 'warn' &&
        (e.message.includes('zero chains') ||
          e.message.includes('no chains')),
    )
    expect(zeroWarns.length).toBeGreaterThan(0)
  })

  it('happy path: data nodes selected, chains extracted, saved', async () => {
    readPaperMock.mockResolvedValueOnce(GOOD_READ)

    // First LLM call: data-node selection → picks the Results section.
    // Second LLM call: batch chain extraction → returns a valid 3-node chain.
    sendLlmChatMock
      .mockResolvedValueOnce({
        success: true,
        content: JSON.stringify({ data_nodes: ['0003'] }),
        durationMs: 200,
      })
      .mockResolvedValueOnce({
        success: true,
        content: JSON.stringify({
          chains: [
            {
              domain_type: 'materials',
              context_text: 'Bi2Te3 sample ZT=0.8',
              confidence: 0.9,
              nodes: [
                { role: 'system', name: 'Bi2Te3', value: null, unit: null },
                {
                  role: 'process',
                  name: 'hot pressing',
                  value: '723',
                  unit: 'K',
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
        durationMs: 600,
      })
    saveChainsMock.mockResolvedValueOnce({
      success: true,
      extraction_id: 1,
      chain_ids: [10],
      count: 1,
    })

    const result = await extractPaperToKnowledge(123)

    expect(result).toEqual({
      paperId: 123,
      success: true,
      chainCount: 1,
      accepted: 1,
      diagnostic: 0,
      rejected: 0,
      fromHeuristic: false,
      stage: 'done',
    })

    // saveChains was called with the one valid chain.
    expect(saveChainsMock).toHaveBeenCalledTimes(1)
    const saveArg = saveChainsMock.mock.calls[0][0]
    expect(saveArg.paper_id).toBe(123)
    expect(saveArg.chains).toHaveLength(1)
    expect(saveArg.chains[0].nodes[0].role).toBe('system')
    expect(saveArg.chains[0].nodes[0].name).toBe('Bi2Te3')

    // Log sequence assertion.
    const knowledgeStages = entriesBySource(
      useLogStore.getState().entries,
      'knowledge',
    ).map(stageOf)
    expect(knowledgeStages).toContain('start')
    expect(knowledgeStages).toContain('read')
    expect(knowledgeStages).toContain('resolve_sections')
    expect(knowledgeStages).toContain('select_data_nodes')
  })

  it('PageIndex returning zero nodes triggers fallback with its own log', async () => {
    readPaperMock.mockResolvedValueOnce(GOOD_READ)

    // Selection call returns empty array.
    sendLlmChatMock
      .mockResolvedValueOnce({
        success: true,
        content: JSON.stringify({ data_nodes: [] }),
        durationMs: 100,
      })
      // Fallback call also returns nothing structured.
      .mockResolvedValueOnce({
        success: true,
        content: 'Sorry, I cannot find chains.',
        durationMs: 200,
      })

    const result = await extractPaperToKnowledge(55)
    expect(result.chainCount).toBe(0)

    const all = useLogStore.getState().entries
    const messages = all.map((e) => e.message)
    expect(
      messages.some((m) =>
        m.includes('PageIndex selected zero data nodes'),
      ),
    ).toBe(true)
    // The fallback zero-chain path also fires a warn.
    expect(
      messages.some(
        (m) =>
          m.includes('zero chains') || m.includes('no chains'),
      ),
    ).toBe(true)
  })
})
