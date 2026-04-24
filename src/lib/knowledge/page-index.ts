// PageIndex — hierarchical tree index for paper RAG / structured-data
// extraction. Port of lattice-cli/src/lattice_cli/page_index_store.py.
//
// Pipeline:
//   1. Build a flat list of sections from the PDF reader output. If the
//      worker only gave us one section per page, attempt to re-split the
//      full text by heading heuristics (numbered headings, ALL-CAPS
//      titles, common keywords like "Introduction", "Methods", etc.).
//   2. Assemble the sections into a tree using their declared level
//      (level 1 under root, level 2 nested under the nearest level-1
//      sibling, and so on).
//   3. Compact the tree — strip full text, keep node_id / title /
//      summary — so the LLM can reason over the structure in ~1-2 KB.
//   4. Ask the LLM to pick `data_nodes` — the sections that actually
//      contain experimental values. One lightweight call.
//   5. Return just those nodes' full text, ready to feed into the
//      chain-extraction prompt.
//
// No DB persistence here (lattice-cli's PageIndexStore persists the
// tree for re-use; we rebuild it per call — cheap, one LLM call).

import type { PaperReadSection } from '../../types/library-api'
import { sendLlmChat } from '../llm-chat'
import { log } from '../logger'
import { DATA_NODE_SELECTION_PROMPT } from './extraction-prompts'

export interface PageIndexNode {
  node_id: string
  title: string
  level: number
  summary: string
  text: string
}

export interface PageIndexTree extends Omit<PageIndexNode, 'node_id' | 'level' | 'text'> {
  node_id: 'root'
  level: 0
  nodes: PageIndexTreeNode[]
}

interface PageIndexTreeNode extends PageIndexNode {
  nodes: PageIndexTreeNode[]
}

export interface SelectedDataNode {
  node_id: string
  title: string
  content: string
}

// ─── 1. Section detection ───────────────────────────────────────────

/** Heading patterns common in scientific papers. Order matters — we
 *  prefer the most specific (numbered sections) before the generic
 *  all-caps fallback. */
const HEADING_PATTERNS: Array<{
  re: RegExp
  level: (m: RegExpMatchArray) => number
}> = [
  // 1. Introduction / 1.1 Methods / 2.3.4 Peak profile
  { re: /^(\d+(?:\.\d+){0,3})\.?\s+([A-Z][\w\s\-\u00C0-\u024F()&'/]{2,60})$/m, level: (m) => (m[1].split('.').length || 1) },
  // ABC-caps headings: "INTRODUCTION", "RESULTS AND DISCUSSION"
  { re: /^([A-Z][A-Z\s\-&/]{2,60})$/m, level: () => 1 },
  // Named sections (any case): "Introduction", "Experimental", "Results"
  {
    re: /^(Abstract|Introduction|Background|Experimental(?:\s+(?:section|methods?|details?))?|Materials? and methods?|Methods?|Methodology|Results?|Discussion|Results? and discussion|Conclusions?|References?|Acknowledg(?:e)?ments?|Appendix|Supplementary(?:\s+information)?)$/im,
    level: () => 1,
  },
]

const MIN_SECTION_LEN = 120
const MIN_SECTIONS_TO_TRUST = 3

/** Try to split the raw paper text into meaningful sections by heading.
 *  Returns `null` when heuristics can't find at least `MIN_SECTIONS_TO_TRUST`
 *  distinct headings — the caller should fall back to whatever the PDF
 *  backend already provided. */
export function detectSectionsFromText(
  fullText: string,
): PaperReadSection[] | null {
  if (!fullText || fullText.length < 200) return null
  const lines = fullText.split('\n')
  const headings: Array<{ index: number; title: string; level: number }> = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.length > 80) continue
    for (const { re, level } of HEADING_PATTERNS) {
      const m = line.match(re)
      if (m) {
        headings.push({ index: i, title: m[0].trim(), level: level(m) })
        break
      }
    }
  }
  if (headings.length < MIN_SECTIONS_TO_TRUST) return null

  // Carve the text into slabs between consecutive headings.
  const sections: PaperReadSection[] = []
  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].index + 1
    const end = i + 1 < headings.length ? headings[i + 1].index : lines.length
    const content = lines.slice(start, end).join('\n').trim()
    if (content.length < MIN_SECTION_LEN) continue
    sections.push({
      title: headings[i].title,
      level: headings[i].level,
      content,
    })
  }
  return sections.length >= MIN_SECTIONS_TO_TRUST ? sections : null
}

/** Choose the best available section list: prefer the worker's output
 *  if it already looks structured (not one section per page), otherwise
 *  re-parse the full text. */
export function resolveSections(
  sections: PaperReadSection[],
  fullText: string,
): PaperReadSection[] {
  const looksPageBased =
    sections.length > 0 &&
    sections.every((s) => /^Page \d+$/.test(s.title.trim()))
  if (!looksPageBased && sections.length >= MIN_SECTIONS_TO_TRUST) {
    return sections
  }
  const detected = detectSectionsFromText(fullText)
  if (detected) return detected
  return sections
}

// ─── 2. Tree build ──────────────────────────────────────────────────

function summarise(text: string, max = 200): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`
}

export function buildTree(sections: PaperReadSection[]): PageIndexTree {
  const root: PageIndexTree = {
    node_id: 'root',
    title: 'Document',
    level: 0,
    summary: '',
    nodes: [],
  }
  if (sections.length === 0) return root

  const flat: PageIndexTreeNode[] = sections.map((s, i) => ({
    node_id: String(i).padStart(4, '0'),
    title: s.title,
    level: s.level ?? 1,
    summary: summarise(s.content),
    text: s.content,
    nodes: [],
  }))

  const stack: Array<PageIndexTree | PageIndexTreeNode> = [root]
  for (const node of flat) {
    while (stack.length > 1 && (stack[stack.length - 1] as PageIndexTreeNode).level >= node.level) {
      stack.pop()
    }
    const parent = stack[stack.length - 1]
    parent.nodes.push(node)
    stack.push(node)
  }
  return root
}

export function createNodeMap(tree: PageIndexTree): Map<string, PageIndexNode> {
  const map = new Map<string, PageIndexNode>()
  const walk = (node: PageIndexTree | PageIndexTreeNode): void => {
    if (node.node_id && node.node_id !== 'root') {
      map.set(node.node_id, node as PageIndexNode)
    }
    for (const child of node.nodes) walk(child)
  }
  walk(tree)
  return map
}

// ─── 3. Compact tree for LLM prompt ─────────────────────────────────

interface CompactNode {
  node_id: string
  title: string
  summary: string
  nodes?: CompactNode[]
}

export function compactTree(tree: PageIndexTree): CompactNode {
  const strip = (
    node: PageIndexTree | PageIndexTreeNode,
  ): CompactNode => {
    const out: CompactNode = {
      node_id: node.node_id,
      title: node.title,
      summary: 'summary' in node ? node.summary : '',
    }
    if (node.nodes.length > 0) {
      out.nodes = node.nodes.map(strip)
    }
    return out
  }
  return strip(tree)
}

// ─── 4. Data-node selection via LLM ─────────────────────────────────

function parseNodeSelection(raw: string): string[] {
  let cleaned = raw.replace(/```(?:json)?\s*/g, '').trim().replace(/`+$/g, '').trim()
  try {
    const parsed = JSON.parse(cleaned)
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).data_nodes)) {
      return (parsed as { data_nodes: unknown[] }).data_nodes
        .filter((x): x is string => typeof x === 'string')
    }
  } catch {
    /* fallthrough */
  }
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as { data_nodes?: unknown[] }
      if (Array.isArray(parsed.data_nodes)) {
        return parsed.data_nodes.filter((x): x is string => typeof x === 'string')
      }
    } catch {
      /* ignore */
    }
  }
  return []
}

export async function selectDataNodes(
  tree: PageIndexTree,
  nodeMap: Map<string, PageIndexNode>,
): Promise<SelectedDataNode[]> {
  if (nodeMap.size === 0) return []

  const compact = compactTree(tree)
  const treeJson = JSON.stringify(compact, null, 2)
  const prompt = DATA_NODE_SELECTION_PROMPT.replace('{tree_json}', treeJson)

  const result = await sendLlmChat({
    mode: 'dialog',
    userMessage: prompt,
    transcript: [],
    sessionId: null,
  })

  if (!result.success) {
    log.error('PageIndex node selection failed', {
      source: 'knowledge',
      type: 'http',
      detail: { stage: 'select_data_nodes', error: result.error },
    })
    return []
  }

  const nodeIds = parseNodeSelection(result.content)
  if (nodeIds.length === 0) {
    log.warn('PageIndex selected zero data nodes', {
      source: 'knowledge',
      type: 'unknown',
      detail: {
        stage: 'select_data_nodes',
        tree_size: nodeMap.size,
        llm_response: result.content.slice(0, 1000),
      },
    })
    return []
  }

  const selected: SelectedDataNode[] = []
  for (const id of nodeIds) {
    const node = nodeMap.get(id)
    if (node?.text) {
      selected.push({
        node_id: id,
        title: node.title,
        content: node.text,
      })
    }
  }

  log.info(
    `PageIndex selected ${selected.length}/${nodeMap.size} data nodes`,
    {
      source: 'knowledge',
      type: 'unknown',
      detail: {
        stage: 'select_data_nodes',
        selected_ids: nodeIds,
        titles: selected.map((s) => s.title),
      },
    },
  )

  return selected
}
