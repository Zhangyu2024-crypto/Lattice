// AI auto-tagging for library papers.
//
// Reads paper metadata (title / authors / abstract / journal) + the global
// tag vocabulary, calls the LLM for 3-8 suggested tags, returns them for
// user confirmation. The tool never writes tags itself — the caller
// (Library detail-pane button or AgentCard Approve) does the actual
// `addTag` calls so the user always reviews before commit.

import type { LocalTool } from '../../types/agent-tool'
import { localProLibrary } from '../local-pro-library'
import { sendLlmChat } from '../llm-chat'

interface Input {
  paperId?: number
  includeFullText?: boolean
}

interface SuccessOutput {
  success: true
  paperId: number
  suggestedTags: string[]
  existingTags: string[]
  reasoning: string
  summary: string
}

interface ErrorOutput {
  success: false
  error: string
}

type Output = SuccessOutput | ErrorOutput

const SYSTEM_PROMPT =
  'You are a materials-science literature tagging expert. Given a paper\'s ' +
  'metadata, suggest 3–8 classification tags.\n' +
  'Rules:\n' +
  '- PREFER reusing tags from the EXISTING TAG LIST below (keeps the ' +
  '  vocabulary consistent across the library).\n' +
  '- Tag categories: technique (xrd, xps, raman, dft, tem, sem, …), ' +
  '  material (perovskite, graphene, mof, …), property (band-gap, ' +
  '  conductivity, …), method (synthesis, characterization, simulation, …).\n' +
  '- All lowercase English, hyphen-separate multi-word (e.g. band-gap).\n' +
  '- Return STRICT JSON only — no prose, no code fences:\n' +
  '  {"tags":["tag1","tag2",...],"reasoning":"one sentence why"}\n'

function stripFence(text: string): string {
  const m = text.trim().match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i)
  return m ? m[1] : text.trim()
}

function parseTagsJson(
  raw: string,
): { tags: string[]; reasoning: string } | null {
  try {
    const parsed = JSON.parse(stripFence(raw))
    if (!parsed || typeof parsed !== 'object') return null
    const tags = Array.isArray(parsed.tags)
      ? (parsed.tags as unknown[])
          .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
          .map((t) => t.trim().toLowerCase().slice(0, 40))
      : []
    const reasoning =
      typeof parsed.reasoning === 'string' ? parsed.reasoning.trim() : ''
    return { tags, reasoning }
  } catch {
    return null
  }
}

export async function runAutoTag(
  paperId: number,
  sessionId: string,
): Promise<Output> {
  if (!localProLibrary.ready) {
    return { success: false, error: 'Library API not available (needs Electron shell)' }
  }

  const papers = await localProLibrary.listPapers({ limit: 200 })
  const paper = papers.papers.find((p) => p.id === paperId)
  if (!paper) {
    return { success: false, error: `Paper ${paperId} not found in library` }
  }

  const existingTagsList = await localProLibrary.listTags()
  const existingTagsFormatted = existingTagsList
    .slice(0, 50)
    .map((t) => `${t.name}(${t.count})`)
    .join(', ')

  const paperInfo = [
    `Title: ${paper.title}`,
    `Authors: ${paper.authors}`,
    `Year: ${paper.year}`,
    paper.journal ? `Journal: ${paper.journal}` : null,
    paper.abstract ? `Abstract: ${paper.abstract.slice(0, 1000)}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const userMessage = [
    SYSTEM_PROMPT,
    '',
    `EXISTING TAG LIST: [${existingTagsFormatted || '(empty — you are the first)'}]`,
    '',
    `PAPER:\n${paperInfo}`,
    '',
    `ALREADY ON THIS PAPER: [${paper.tags?.join(', ') || '(none)'}]`,
    'Suggest NEW tags that are NOT already on this paper.',
  ].join('\n')

  const llm = await sendLlmChat({
    mode: 'dialog',
    userMessage,
    transcript: [],
    sessionId,
  })

  if (!llm.success) {
    return { success: false, error: llm.error ?? 'LLM call failed' }
  }

  const parsed = parseTagsJson(llm.content)
  if (!parsed || parsed.tags.length === 0) {
    return {
      success: false,
      error: 'LLM returned no parseable tags. Raw: ' + llm.content.slice(0, 200),
    }
  }

  // Filter out tags already on the paper
  const existingSet = new Set((paper.tags ?? []).map((t) => t.toLowerCase()))
  const newTags = parsed.tags.filter((t) => !existingSet.has(t))

  return {
    success: true,
    paperId,
    suggestedTags: newTags,
    existingTags: paper.tags ?? [],
    reasoning: parsed.reasoning,
    summary: `${newTags.length} tag${newTags.length === 1 ? '' : 's'} suggested for "${paper.title.slice(0, 40)}"`,
  }
}

export const autoTagPaperTool: LocalTool<Input, Output> = {
  name: 'auto_tag_paper',
  description:
    'Analyze a library paper\'s metadata (title, authors, abstract) and ' +
    'suggest 3–8 classification tags. Prefers reusing existing library ' +
    'tags for consistency. Returns suggestions for human review — does ' +
    'not apply tags directly.',
  trustLevel: 'safe',
  cardMode: 'review',
  inputSchema: {
    type: 'object',
    properties: {
      paperId: {
        type: 'number',
        description: 'Library paper id to tag.',
      },
      includeFullText: {
        type: 'boolean',
        description:
          'Include PDF full text in the prompt (slower, more accurate). Default false.',
      },
    },
    required: ['paperId'],
  },
  async execute(input, ctx) {
    const paperId =
      typeof input?.paperId === 'number' ? input.paperId : NaN
    if (!Number.isFinite(paperId)) {
      return { success: false, error: 'paperId must be a number' }
    }
    return runAutoTag(paperId, ctx.sessionId)
  },
}
