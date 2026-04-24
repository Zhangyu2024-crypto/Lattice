// Knowledge chain extraction via LLM — self-contained frontend pipeline.
// Mirrors lattice-cli/tools/paper_extract.py stages:
//   1. Section classification (regex, zero-cost)
//   2. LLM chain extraction
//   3. Validation + dedup

import { sendLlmChat } from '../llm-chat'
import { log } from '../logger'
import {
  EXTRACT_CHAINS_SYSTEM,
  EXTRACT_CHAINS_PROMPT,
  BATCH_EXTRACT_PROMPT,
  CLASSIFY_PROJECT_PROMPT,
} from './extraction-prompts'

// ── Types ─────────────────────────────────────────────────────────

export interface ExtractedNode {
  role: 'system' | 'process' | 'state' | 'measurement'
  name: string
  value: string | null
  unit: string | null
  metadata?: Record<string, unknown>
}

export interface ExtractedChain {
  domain_type: string
  context_text: string
  context_section?: string
  confidence: number
  nodes: ExtractedNode[]
}

export interface ExtractionResult {
  success: boolean
  chains: ExtractedChain[]
  error?: string
  durationMs?: number
}

export interface ProjectClassification {
  project_name: string
  confidence: number
  keywords: string[]
}

// ── Section classification (zero-cost regex) ──────────────────────

const SECTION_KEYWORDS: Record<string, string[]> = {
  experimental: [
    'experimental', 'methods', 'materials and methods',
    'procedure', 'synthesis', 'preparation', 'fabrication',
  ],
  results: [
    'results', 'results and discussion', 'findings',
    'measurements', 'characterization',
  ],
  discussion: ['discussion', 'analysis', 'interpretation'],
  introduction: ['introduction', 'background', 'motivation'],
}

const NUMERIC_WITH_UNIT =
  /\d+\.?\d*\s*(?:°C|K|GPa|MPa|eV|nm|cm|%|±|Å|μm|mA|mV|mg|mL|mol)/g

export interface TextSection {
  title: string
  content: string
  level?: number
}

export function classifySections(
  sections: TextSection[],
): Array<{ section: TextSection; category: string }> {
  const candidates: Array<{ section: TextSection; category: string }> = []
  for (const sec of sections) {
    const titleLower = sec.title.toLowerCase()
    let matched = false
    for (const [category, keywords] of Object.entries(SECTION_KEYWORDS)) {
      if (keywords.some((kw) => titleLower.includes(kw))) {
        candidates.push({ section: sec, category })
        matched = true
        break
      }
    }
    if (!matched) {
      const numbers = sec.content.match(NUMERIC_WITH_UNIT)
      if (numbers && numbers.length >= 3) {
        candidates.push({ section: sec, category: 'data_rich' })
      }
    }
  }
  return candidates
}

// ── LLM call wrapper ──────────────────────────────────────────────

async function callLlm(
  systemPrompt: string,
  userPrompt: string,
  _maxTokens = 4000,
): Promise<{ success: boolean; content: string; error?: string; durationMs?: number }> {
  try {
    const result = await sendLlmChat({
      mode: 'dialog',
      userMessage: userPrompt,
      transcript: [],
      sessionId: null,
      systemPromptOverride: systemPrompt,
    })
    if (!result.success) {
      return { success: false, content: '', error: result.error, durationMs: result.durationMs }
    }
    return { success: true, content: result.content, durationMs: result.durationMs }
  } catch (err) {
    return {
      success: false,
      content: '',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// ── JSON parsing (tolerates markdown fences) ──────────────────────

function parseJsonResponse(text: string): Record<string, unknown> {
  let cleaned = text.replace(/```(?:json)?\s*/g, '').trim().replace(/`+$/g, '').trim()
  try {
    const parsed = JSON.parse(cleaned)
    if (Array.isArray(parsed)) return { chains: parsed }
    if (typeof parsed === 'object' && parsed !== null) return coerceParsedObject(parsed as Record<string, unknown>)
  } catch { /* fallthrough */ }
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (match) {
    try {
      const parsed = JSON.parse(match[0])
      if (Array.isArray(parsed)) return { chains: parsed }
      if (typeof parsed === 'object' && parsed !== null) return coerceParsedObject(parsed as Record<string, unknown>)
    } catch { /* fallthrough */ }
  }
  return { chains: [] }
}

function coerceParsedObject(parsed: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(parsed.chains)) return parsed
  if (Array.isArray(parsed.extractions)) return { ...parsed, chains: parsed.extractions }
  if (Array.isArray(parsed.results)) return { ...parsed, chains: parsed.results }
  if (Array.isArray(parsed.nodes)) return { chains: [parsed] }
  const chain = parsed.chain
  if (chain && typeof chain === 'object') return { ...parsed, chains: [chain] }
  return parsed
}

function extractRawChains(parsed: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(parsed.chains)
    ? parsed.chains.filter(
        (chain): chain is Record<string, unknown> =>
          typeof chain === 'object' && chain !== null,
      )
    : []
}

// ── Chain validation + dedup ──────────────────────────────────────

const VALID_ROLES = new Set(['system', 'process', 'state', 'measurement'])

/** Structural sanity check — ≥2 nodes, valid roles, non-empty names.
 *  Does NOT judge scientific quality; that's `evaluateChainQuality` in
 *  `quality-evaluator.ts`. Keeping the two passes separate means prompt
 *  changes only require editing the evaluator, not this function. */
function validateChainShape(chain: Record<string, unknown>): chain is { nodes: ExtractedNode[]; [k: string]: unknown } {
  const nodes = chain.nodes
  if (!Array.isArray(nodes) || nodes.length < 2) return false
  const validNodes = nodes.filter(
    (n: unknown) =>
      typeof n === 'object' &&
      n !== null &&
      VALID_ROLES.has((n as Record<string, unknown>).role as string) &&
      typeof (n as Record<string, unknown>).name === 'string' &&
      ((n as Record<string, unknown>).name as string).trim().length > 0,
  )
  return validNodes.length >= 2
}

/** Does a chain carry at least one numeric value? Used only for
 *  bookkeeping in logs — chains without values are still kept (better
 *  to show a role+name chain than nothing at all). */
function chainHasValues(chain: ExtractedChain): boolean {
  return chain.nodes.some(
    (n) => n.value != null && String(n.value).trim() !== '',
  )
}

function deduplicateChains(chains: ExtractedChain[]): ExtractedChain[] {
  const seen = new Set<string>()
  const result: ExtractedChain[] = []
  for (const chain of chains) {
    const sysSig = chain.nodes
      .filter((n) => n.role === 'system')
      .map((n) => `${n.name}|${n.value ?? ''}`)
      .join(';')
    const measSig = chain.nodes
      .filter((n) => n.role === 'measurement')
      .map((n) => `${n.name}|${n.value ?? ''}`)
      .join(';')
    const key = `${sysSig}::${measSig}`
    if (!seen.has(key)) {
      seen.add(key)
      result.push(chain)
    }
  }
  return result
}

function normalizeChain(raw: Record<string, unknown>): ExtractedChain {
  const nodes: ExtractedNode[] = (raw.nodes as Array<Record<string, unknown>>).map((n) => ({
    role: n.role as ExtractedNode['role'],
    name: String(n.name ?? ''),
    value: n.value != null ? String(n.value) : null,
    unit: n.unit != null ? String(n.unit) : null,
    metadata: typeof n.metadata === 'object' && n.metadata ? (n.metadata as Record<string, unknown>) : undefined,
  }))
  return {
    domain_type: String(raw.domain_type ?? 'materials'),
    context_text: String(raw.context_text ?? '').slice(0, 200),
    context_section: raw.context_section != null ? String(raw.context_section) : undefined,
    confidence: typeof raw.confidence === 'number' ? Math.max(0, Math.min(1, raw.confidence)) : 0.5,
    nodes,
  }
}

const HEURISTIC_NUMERIC_WITH_UNIT =
  /([-+]?\d+(?:\.\d+)?)\s*(°C|K|GPa|MPa|Pa|eV|nm|cm|mm|Å|μm|µm|mA|A|mV|V|mg|g|mL|L|mol|%|wt%|mol%|S\/cm|W\/mK|h|min|s)\b/g

function guessMaterialName(sentence: string): string {
  const formula = sentence.match(/\b(?:[A-Z][a-z]?\d*){2,}(?:[-–—/](?:[A-Z][a-z]?\d*){2,})*\b/)
  if (formula) return formula[0]
  const sample = sentence.match(/\b(?:sample|film|ceramic|compound|material|alloy|powder|crystal)s?\s+[A-Z0-9-]+\b/i)
  if (sample) return sample[0]
  return 'reported material'
}

function guessMeasurementName(sentence: string, matchIndex: number): string {
  const before = sentence.slice(0, matchIndex).replace(/[()=,:;]+/g, ' ')
  const words = before.trim().split(/\s+/).filter(Boolean).slice(-5)
  const label = words.join(' ').replace(/^(of|was|is|to|at|about|approximately)\s+/i, '')
  return label.length >= 3 ? label : 'reported value'
}

function heuristicChainsFromText(text: string, sectionTitle?: string): ExtractedChain[] {
  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence.length >= 40 && /\d/.test(sentence))
  const chains: ExtractedChain[] = []
  for (const sentence of sentences) {
    HEURISTIC_NUMERIC_WITH_UNIT.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = HEURISTIC_NUMERIC_WITH_UNIT.exec(sentence)) && chains.length < 12) {
      chains.push({
        domain_type: 'materials',
        context_text: sentence.slice(0, 200),
        context_section: sectionTitle,
        confidence: 0.35,
        nodes: [
          {
            role: 'system',
            name: guessMaterialName(sentence),
            value: null,
            unit: null,
          },
          {
            role: 'measurement',
            name: guessMeasurementName(sentence, match.index),
            value: match[1],
            unit: match[2],
          },
        ],
      })
    }
    if (chains.length >= 12) break
  }
  return deduplicateChains(chains)
}

// ── Public API ────────────────────────────────────────────────────

const MAX_TEXT_CHARS = 12000

export async function extractChainsFromText(
  text: string,
  sectionTitle?: string,
): Promise<ExtractionResult> {
  const trimmed = text.slice(0, MAX_TEXT_CHARS)
  if (trimmed.length < 50) {
    return { success: false, chains: [], error: 'Text too short for extraction.' }
  }

  const prompt = EXTRACT_CHAINS_PROMPT.replace('{text}', trimmed)
  const llmResult = await callLlm(EXTRACT_CHAINS_SYSTEM, prompt)
  if (!llmResult.success) {
    log.error('LLM call failed during chain extraction', {
      source: 'knowledge',
      type: 'http',
      detail: {
        stage: 'extract_chains_from_text',
        sectionTitle,
        error: llmResult.error,
        textLen: trimmed.length,
      },
    })
    return { success: false, chains: [], error: llmResult.error, durationMs: llmResult.durationMs }
  }

  const parsed = parseJsonResponse(llmResult.content)
  const rawChains = extractRawChains(parsed)
  const validChains = rawChains.filter(validateChainShape).map(normalizeChain)
  if (sectionTitle) {
    for (const c of validChains) {
      c.context_section ??= sectionTitle
    }
  }
  let deduped = deduplicateChains(validChains)
  const heuristicChains = deduped.length === 0
    ? heuristicChainsFromText(trimmed, sectionTitle)
    : []
  if (heuristicChains.length > 0) deduped = heuristicChains

  if (deduped.length === 0) {
    log.warn('Chain extraction returned zero chains', {
      source: 'knowledge',
      type: 'unknown',
      detail: {
        stage: 'extract_chains_from_text',
        sectionTitle,
        textLen: trimmed.length,
        rawChains: rawChains.length,
        invalidChains: rawChains.length - validChains.length,
        heuristicChains: heuristicChains.length,
        llm_response: llmResult.content.slice(0, 1500),
        llm_durationMs: llmResult.durationMs,
      },
    })
  } else {
    const rich = deduped.filter(chainHasValues).length
    log.info(
      `Chain extraction: ${deduped.length} chains (${rich} with values) from ${rawChains.length} raw`,
      {
        source: 'knowledge',
        type: 'unknown',
        detail: {
          stage: 'extract_chains_from_text',
          sectionTitle,
          rawChains: rawChains.length,
          deduped: deduped.length,
          shallow: deduped.length - rich,
          llm_durationMs: llmResult.durationMs,
        },
      },
    )
  }

  return { success: true, chains: deduped, durationMs: llmResult.durationMs }
}

export async function extractChainsFromSections(
  sections: TextSection[],
): Promise<ExtractionResult> {
  const candidates = classifySections(sections)
  if (candidates.length === 0 && sections.length > 0) {
    candidates.push(
      ...sections.slice(0, 5).map((s) => ({ section: s, category: 'full' })),
    )
  }
  if (candidates.length === 0) {
    return { success: false, chains: [], error: 'No suitable sections found.' }
  }

  const sectionsText = candidates
    .map((c) => `=== ${c.section.title} ===\n${c.section.content}`)
    .join('\n\n')
    .slice(0, MAX_TEXT_CHARS)

  const prompt = BATCH_EXTRACT_PROMPT.replace('{text}', sectionsText)
  const llmResult = await callLlm(EXTRACT_CHAINS_SYSTEM, prompt)
  if (!llmResult.success) {
    log.error('LLM call failed during batch chain extraction', {
      source: 'knowledge',
      type: 'http',
      detail: {
        stage: 'extract_chains_from_sections',
        sectionCount: candidates.length,
        sectionsTextLen: sectionsText.length,
        error: llmResult.error,
      },
    })
    return { success: false, chains: [], error: llmResult.error, durationMs: llmResult.durationMs }
  }

  const parsed = parseJsonResponse(llmResult.content)
  const rawChains = extractRawChains(parsed)
  const validChains = rawChains.filter(validateChainShape).map(normalizeChain)
  let deduped = deduplicateChains(validChains)
  const heuristicChains = deduped.length === 0
    ? heuristicChainsFromText(sectionsText)
    : []
  if (heuristicChains.length > 0) deduped = heuristicChains

  if (deduped.length === 0) {
    log.warn('Batch chain extraction returned zero chains', {
      source: 'knowledge',
      type: 'unknown',
      detail: {
        stage: 'extract_chains_from_sections',
        sectionCount: candidates.length,
        sectionTitles: candidates.map((c) => c.section.title).slice(0, 10),
        sectionsTextLen: sectionsText.length,
        rawChains: rawChains.length,
        invalidChains: rawChains.length - validChains.length,
        heuristicChains: heuristicChains.length,
        llm_response: llmResult.content.slice(0, 1500),
        llm_durationMs: llmResult.durationMs,
      },
    })
  } else {
    const rich = deduped.filter(chainHasValues).length
    log.info(
      `Batch chain extraction: ${deduped.length} chains (${rich} with values) from ${rawChains.length} raw`,
      {
        source: 'knowledge',
        type: 'unknown',
        detail: {
          stage: 'extract_chains_from_sections',
          sectionCount: candidates.length,
          rawChains: rawChains.length,
          deduped: deduped.length,
          shallow: deduped.length - rich,
          llm_durationMs: llmResult.durationMs,
        },
      },
    )
  }

  return { success: true, chains: deduped, durationMs: llmResult.durationMs }
}

export async function classifyProject(
  title: string,
  contentSnippet: string,
): Promise<ProjectClassification> {
  const prompt = CLASSIFY_PROJECT_PROMPT
    .replace('{title}', title || '(untitled)')
    .replace('{content}', contentSnippet.slice(0, 2000))

  const result = await callLlm(EXTRACT_CHAINS_SYSTEM, prompt, 500)
  if (!result.success) {
    return { project_name: 'Uncategorized', confidence: 0, keywords: [] }
  }

  const parsed = parseJsonResponse(result.content)
  return {
    project_name: String(parsed.project_name ?? 'Uncategorized'),
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    keywords: Array.isArray(parsed.keywords) ? (parsed.keywords as string[]) : [],
  }
}
