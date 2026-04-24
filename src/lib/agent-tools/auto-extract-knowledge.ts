// Auto-extract structured knowledge from a paper via LLM.
//
// On paper open, if no cached extraction exists, runs a one-shot LLM call
// that reads the paper's abstract + available full text and produces:
//   - Structured triples: (material, property, value, method)
//   - Key findings: one-sentence summaries
//
// Results are cached on the paper artifact payload so re-opening skips
// the LLM call. The Knowledge tab reads from this cache.

import type { LocalTool } from '../../types/agent-tool'
import { localProLibrary } from '../local-pro-library'
import { sendLlmChat } from '../llm-chat'

export interface KnowledgeTriple {
  material: string
  property: string
  value: string
  method?: string
  confidence?: 'high' | 'medium' | 'low'
}

export interface KnowledgeFinding {
  text: string
  page?: number
}

export interface ExtractedKnowledge {
  triples: KnowledgeTriple[]
  findings: KnowledgeFinding[]
  extractedAt: number
}

interface Input {
  paperId?: number
}

interface SuccessOutput {
  success: true
  paperId: number
  triples: KnowledgeTriple[]
  findings: KnowledgeFinding[]
  summary: string
}

interface ErrorOutput {
  success: false
  error: string
}

type Output = SuccessOutput | ErrorOutput

const SYSTEM_PROMPT =
  'You are a materials-science knowledge extractor. Given a paper\'s metadata ' +
  'and text, extract structured knowledge.\n\n' +
  'Return STRICT JSON only (no prose, no code fences):\n' +
  '{\n' +
  '  "triples": [\n' +
  '    {"material":"BaTiO3","property":"band gap","value":"3.2 eV","method":"DFT-GGA+U","confidence":"high"},\n' +
  '    ...\n' +
  '  ],\n' +
  '  "findings": [\n' +
  '    {"text":"BaTiO3 shows a direct band gap of 3.2 eV under GGA+U approximation."},\n' +
  '    ...\n' +
  '  ]\n' +
  '}\n\n' +
  'Rules:\n' +
  '- Extract 3-15 triples (material → property → value → method)\n' +
  '- Extract 3-8 key findings (one sentence each)\n' +
  '- Only extract facts explicitly stated in the paper\n' +
  '- confidence: "high" = directly stated with numbers, "medium" = stated qualitatively, "low" = inferred\n' +
  '- method: experimental technique or computational method used\n'

function stripFence(text: string): string {
  const m = text.trim().match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i)
  return m ? m[1] : text.trim()
}

function parseResult(
  raw: string,
): { triples: KnowledgeTriple[]; findings: KnowledgeFinding[] } | null {
  try {
    const parsed = JSON.parse(stripFence(raw))
    if (!parsed || typeof parsed !== 'object') return null
    const triples: KnowledgeTriple[] = []
    if (Array.isArray(parsed.triples)) {
      for (const t of parsed.triples) {
        if (!t || typeof t !== 'object') continue
        if (typeof t.material !== 'string' || typeof t.property !== 'string') continue
        triples.push({
          material: t.material,
          property: t.property,
          value: typeof t.value === 'string' ? t.value : String(t.value ?? ''),
          method: typeof t.method === 'string' ? t.method : undefined,
          confidence:
            t.confidence === 'high' || t.confidence === 'medium' || t.confidence === 'low'
              ? t.confidence
              : undefined,
        })
      }
    }
    const findings: KnowledgeFinding[] = []
    if (Array.isArray(parsed.findings)) {
      for (const f of parsed.findings) {
        if (!f || typeof f !== 'object') continue
        if (typeof f.text !== 'string') continue
        findings.push({
          text: f.text,
          page: typeof f.page === 'number' ? f.page : undefined,
        })
      }
    }
    return { triples, findings }
  } catch {
    return null
  }
}

export async function runAutoExtract(
  paperId: number,
  sessionId: string,
  paperText?: string,
): Promise<Output> {
  if (!localProLibrary.ready) {
    return { success: false, error: 'Library API not available' }
  }

  const papers = await localProLibrary.listPapers({ limit: 200 })
  const paper = papers.papers.find((p) => p.id === paperId)
  if (!paper) {
    return { success: false, error: `Paper ${paperId} not found` }
  }

  const paperInfo = [
    `Title: ${paper.title}`,
    `Authors: ${paper.authors}`,
    `Year: ${paper.year}`,
    paper.journal ? `Journal: ${paper.journal}` : null,
    paper.abstract ? `Abstract: ${paper.abstract}` : null,
    paperText ? `\nFull text (excerpt):\n${paperText.slice(0, 4000)}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const userMessage = `${SYSTEM_PROMPT}\n\nPAPER:\n${paperInfo}`

  const llm = await sendLlmChat({
    mode: 'dialog',
    userMessage,
    transcript: [],
    sessionId,
  })

  if (!llm.success) {
    return { success: false, error: llm.error ?? 'LLM call failed' }
  }

  const parsed = parseResult(llm.content)
  if (!parsed) {
    return {
      success: false,
      error: 'Could not parse extraction result',
    }
  }

  return {
    success: true,
    paperId,
    triples: parsed.triples,
    findings: parsed.findings,
    summary: `${parsed.triples.length} triples + ${parsed.findings.length} findings`,
  }
}

export const autoExtractKnowledgeTool: LocalTool<Input, Output> = {
  name: 'auto_extract_knowledge',
  description:
    'Extract structured knowledge (material-property-value triples + key ' +
    'findings) from a library paper using AI. Results are cached on the ' +
    'paper artifact.',
  trustLevel: 'safe',
  cardMode: 'review',
  inputSchema: {
    type: 'object',
    properties: {
      paperId: { type: 'number', description: 'Library paper id.' },
    },
    required: ['paperId'],
  },
  async execute(input, ctx) {
    const paperId = typeof input?.paperId === 'number' ? input.paperId : NaN
    if (!Number.isFinite(paperId)) {
      return { success: false, error: 'paperId must be a number' }
    }
    return runAutoExtract(paperId, ctx.sessionId)
  },
}
