// Demonstration: run the full extraction pipeline on a realistic
// scientific paper text, with a mocked LLM that returns what a
// well-prompted model would actually produce. Prints every stage so the
// developer can eyeball the end-to-end flow.
//
// Run with: npx vitest run src/lib/knowledge/demo-real-paper.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const readPaperMock = vi.fn()
const sendLlmChatMock = vi.fn()

interface StoredChain {
  paper_id: number
  chain_id: number
  nodes: Array<Record<string, unknown>>
  confidence?: number
  domain_type?: string
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

const chainsByPaperMock = vi.fn(async (paperId: number) =>
  stored
    .filter((c) => c.paper_id === paperId)
    .map((c) => ({
      chain_id: c.chain_id,
      extraction_id: 1,
      paper_id: paperId,
      paper_title: 'Test paper',
      domain_type: c.domain_type,
      confidence: c.confidence ?? 0.5,
      context_section: c.context_section,
      context_text: c.context_text,
      nodes: c.nodes,
    })),
)

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

// ───────────────────────────────────────────────────────────────────
// Sample paper — a realistic looking thermoelectric materials paper
// with proper sections. Adapted from typical Bi2Te3 / skutterudite
// literature so the LLM has real numbers to extract.
// ───────────────────────────────────────────────────────────────────

const PAPER_FULL_TEXT = `
Abstract

We report enhanced thermoelectric performance in n-type Bi2Te2.7Se0.3
fabricated by spark plasma sintering (SPS). The optimized sample shows
a peak ZT of 1.25 at 400 K, representing a 35% improvement over
conventional hot-pressed samples. X-ray diffraction confirms a pure
rhombohedral phase (space group R-3m).

1. Introduction

Thermoelectric materials enable direct conversion between heat and
electricity, with applications in waste heat recovery and solid-state
cooling. Bi2Te3-based alloys remain the benchmark for room-temperature
applications. Recent advances in nanostructuring have demonstrated ZT
values exceeding unity.

2. Experimental

2.1 Synthesis

High-purity Bi (99.99%), Te (99.999%), and Se (99.99%) powders were
mixed in the stoichiometric ratio Bi2Te2.7Se0.3 and melted in a sealed
quartz ampule at 1073 K for 12 hours. The ingots were crushed, ball-
milled for 6 hours at 300 rpm in argon atmosphere, and consolidated by
spark plasma sintering at 723 K under 60 MPa for 5 minutes.

2.2 Characterization

Phase purity was examined by powder XRD (Rigaku SmartLab, Cu Kα,
λ=1.5418 Å) from 10° to 80° 2θ. Microstructure was studied by FESEM.
Electrical conductivity and Seebeck coefficient were measured
simultaneously on a ZEM-3 from 300 K to 500 K. Thermal conductivity
was calculated from diffusivity (LFA 457) using κ = α·ρ·Cp.

3. Results and Discussion

XRD patterns show a single rhombohedral phase (R-3m) with lattice
parameters a = 4.385 Å and c = 30.49 Å, matching JCPDS 15-0863 for
Bi2Te3. FESEM reveals a dense microstructure with an average grain
size of 2.3 μm.

The sample exhibits electrical conductivity of 1150 S/cm at 300 K,
decreasing to 780 S/cm at 500 K. The Seebeck coefficient reaches
-215 μV/K at 400 K. The power factor peaks at 4.1 mW/m·K² at 400 K.

Thermal conductivity drops from 1.35 W/m·K at 300 K to 0.95 W/m·K at
500 K, attributed to intense point-defect scattering from Se
substitution. Combining these values yields a peak ZT of 1.25 at 400 K,
outperforming the hot-pressed baseline (ZT = 0.92) under identical
compositions.

4. Conclusion

SPS-consolidated Bi2Te2.7Se0.3 achieves a 35% ZT improvement through
reduced thermal conductivity while maintaining high power factor.
`.trim()

const GOOD_READ = {
  success: true as const,
  full_text: PAPER_FULL_TEXT,
  sections: [{ title: 'Page 1', level: 1, content: PAPER_FULL_TEXT }],
  page_count: 1,
}

// What a properly-prompted LLM should return for the data-node selection
// call. It picks the Experimental and Results sections.
const DATA_NODE_RESPONSE = JSON.stringify({
  data_nodes: ['0004', '0006', '0007'],
  reasoning: 'Experimental and Results sections contain synthesis params and measurement values.',
})

// What a properly-prompted LLM should return for the batch chain
// extraction. Multiple chains with full detail.
const CHAIN_RESPONSE = JSON.stringify({
  chains: [
    {
      domain_type: 'materials',
      context_text:
        'spark plasma sintering at 723 K under 60 MPa for 5 minutes. XRD confirms a pure rhombohedral phase (R-3m).',
      context_section: 'Experimental',
      confidence: 0.9,
      nodes: [
        { role: 'system', name: 'Bi2Te2.7Se0.3', value: null, unit: null },
        { role: 'process', name: 'SPS temperature', value: '723', unit: 'K' },
        { role: 'process', name: 'SPS pressure', value: '60', unit: 'MPa' },
        { role: 'process', name: 'SPS time', value: '5', unit: 'min' },
        { role: 'state', name: 'crystal structure', value: 'R-3m', unit: null },
      ],
    },
    {
      domain_type: 'materials',
      context_text:
        'FESEM reveals a dense microstructure with an average grain size of 2.3 μm.',
      context_section: 'Results',
      confidence: 0.88,
      nodes: [
        { role: 'system', name: 'Bi2Te2.7Se0.3', value: null, unit: null },
        { role: 'process', name: 'spark plasma sintering', value: null, unit: null },
        { role: 'state', name: 'grain size', value: '2.3', unit: 'μm' },
      ],
    },
    {
      domain_type: 'materials',
      context_text:
        'The sample exhibits electrical conductivity of 1150 S/cm at 300 K',
      context_section: 'Results',
      confidence: 0.92,
      nodes: [
        { role: 'system', name: 'Bi2Te2.7Se0.3', value: null, unit: null },
        { role: 'measurement', name: 'electrical conductivity', value: '1150', unit: 'S/cm' },
        { role: 'measurement', name: 'temperature', value: '300', unit: 'K' },
      ],
    },
    {
      domain_type: 'materials',
      context_text:
        'The Seebeck coefficient reaches -215 μV/K at 400 K. The power factor peaks at 4.1 mW/m·K² at 400 K.',
      context_section: 'Results',
      confidence: 0.95,
      nodes: [
        { role: 'system', name: 'Bi2Te2.7Se0.3', value: null, unit: null },
        { role: 'measurement', name: 'Seebeck coefficient', value: '-215', unit: 'μV/K' },
        { role: 'measurement', name: 'power factor', value: '4.1', unit: 'mW/m·K²' },
      ],
    },
    {
      domain_type: 'materials',
      context_text:
        'Combining these values yields a peak ZT of 1.25 at 400 K, outperforming the hot-pressed baseline (ZT = 0.92).',
      context_section: 'Results',
      confidence: 0.95,
      nodes: [
        { role: 'system', name: 'Bi2Te2.7Se0.3 (SPS)', value: null, unit: null },
        { role: 'process', name: 'spark plasma sintering', value: null, unit: null },
        { role: 'measurement', name: 'peak ZT', value: '1.25', unit: null },
        { role: 'measurement', name: 'temperature', value: '400', unit: 'K' },
      ],
    },
    {
      domain_type: 'materials',
      context_text:
        'Thermal conductivity drops from 1.35 W/m·K at 300 K to 0.95 W/m·K at 500 K',
      context_section: 'Results',
      confidence: 0.9,
      nodes: [
        { role: 'system', name: 'Bi2Te2.7Se0.3 (SPS)', value: null, unit: null },
        { role: 'measurement', name: 'thermal conductivity (300K)', value: '1.35', unit: 'W/m·K' },
        { role: 'measurement', name: 'thermal conductivity (500K)', value: '0.95', unit: 'W/m·K' },
      ],
    },
  ],
})

function formatChain(c: StoredChain, i: number): string {
  const lines: string[] = []
  lines.push(`\n  ── Chain ${i + 1} (id=${c.chain_id}, conf=${c.confidence}) ──`)
  if (c.context_section) lines.push(`     section: ${c.context_section}`)
  if (c.context_text) lines.push(`     quote:   "${c.context_text}"`)
  for (const n of c.nodes) {
    const value = (n.value as string | null | undefined) ?? null
    const unit = (n.unit as string | null | undefined) ?? null
    const vstr =
      value != null && value !== ''
        ? ` = ${value}${unit ? ` ${unit}` : ''}`
        : ''
    lines.push(`     ${String(n.role).padEnd(12)} ${n.name}${vstr}`)
  }
  return lines.join('\n')
}

describe('demo: realistic paper → full pipeline', () => {
  beforeEach(() => {
    readPaperMock.mockReset()
    sendLlmChatMock.mockReset()
    saveChainsMock.mockClear()
    stored.length = 0
    nextChainId = 1000
  })

  it('extracts rich chains end-to-end', async () => {
    readPaperMock.mockResolvedValueOnce(GOOD_READ)
    sendLlmChatMock
      .mockResolvedValueOnce({
        success: true,
        content: DATA_NODE_RESPONSE,
        durationMs: 120,
      })
      .mockResolvedValueOnce({
        success: true,
        content: CHAIN_RESPONSE,
        durationMs: 800,
      })

    // Print paper header.
    // eslint-disable-next-line no-console
    console.log(
      '\n═══════════════════════════════════════════════════════════════',
    )
    // eslint-disable-next-line no-console
    console.log('  DEMO: End-to-end chain extraction on a real-style paper')
    // eslint-disable-next-line no-console
    console.log(
      '═══════════════════════════════════════════════════════════════',
    )
    // eslint-disable-next-line no-console
    console.log(
      `\n  Paper length: ${PAPER_FULL_TEXT.length} chars, sections: 1 raw (one-per-page)`,
    )

    const result = await extractPaperToKnowledge(42)

    // eslint-disable-next-line no-console
    console.log(`\n  Pipeline result: ${JSON.stringify(result)}`)
    // eslint-disable-next-line no-console
    console.log(`  LLM calls:       ${sendLlmChatMock.mock.calls.length}`)
    // eslint-disable-next-line no-console
    console.log(`  Chains saved:    ${stored.length}`)

    expect(result.success).toBe(true)
    expect(result.chainCount).toBeGreaterThanOrEqual(4)
    expect(sendLlmChatMock).toHaveBeenCalledTimes(2)

    // ── First LLM call: PageIndex data-node selection ────────────
    const firstCall = sendLlmChatMock.mock.calls[0][0]
    const firstPrompt = String(firstCall.userMessage)
    // eslint-disable-next-line no-console
    console.log(
      '\n  ── LLM call #1: PageIndex data-node selection ──────────────',
    )
    // eslint-disable-next-line no-console
    console.log(`  Prompt length: ${firstPrompt.length} chars`)
    // eslint-disable-next-line no-console
    console.log(
      `  Prompt snippet: ${firstPrompt.slice(0, 200).replace(/\n+/g, ' ')}…`,
    )
    // eslint-disable-next-line no-console
    console.log(`  Response:      ${DATA_NODE_RESPONSE}`)

    // ── Second LLM call: chain extraction ────────────────────────
    const secondCall = sendLlmChatMock.mock.calls[1][0]
    const secondPrompt = String(secondCall.userMessage)
    // eslint-disable-next-line no-console
    console.log(
      '\n  ── LLM call #2: chain extraction (batched) ─────────────────',
    )
    // eslint-disable-next-line no-console
    console.log(`  Prompt length: ${secondPrompt.length} chars`)
    // eslint-disable-next-line no-console
    console.log(
      `  Prompt snippet: ${secondPrompt.slice(0, 200).replace(/\n+/g, ' ')}…`,
    )

    // ── Saved chains ─────────────────────────────────────────────
    // eslint-disable-next-line no-console
    console.log(
      '\n  ── Chains persisted (read back via chainsByPaper) ──────────',
    )
    const back = await localProKnowledge.chainsByPaper(42)
    for (let i = 0; i < back.length; i++) {
      // eslint-disable-next-line no-console
      console.log(formatChain(back[i] as never, i))
    }

    // Basic smoke assertions on the rich content.
    const flat = back.flatMap((c) => c.nodes)
    const withValues = flat.filter(
      (n) => n.value != null && String(n.value).trim() !== '',
    )
    // eslint-disable-next-line no-console
    console.log(
      `\n  Totals: ${flat.length} nodes across ${back.length} chains; ${withValues.length} carry a numeric value.`,
    )
    // eslint-disable-next-line no-console
    console.log(
      '═══════════════════════════════════════════════════════════════\n',
    )

    expect(withValues.length).toBeGreaterThanOrEqual(10)
    // Spot-check key numbers actually made it through.
    const measurements = flat.filter((n) => n.role === 'measurement')
    expect(measurements.some((n) => n.value === '1.25')).toBe(true) // peak ZT
    expect(measurements.some((n) => n.value === '1150')).toBe(true) // σ
    expect(measurements.some((n) => n.value === '-215')).toBe(true) // Seebeck
  })
})
