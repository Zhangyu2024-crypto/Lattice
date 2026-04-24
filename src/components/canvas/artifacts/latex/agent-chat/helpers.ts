// Pure helpers for the Creator assistant — prompt assembly, markdown
// code-block parsing, turn-id generation, and small classifiers used by
// the bubble renderer. Kept framework-free so they remain trivially
// unit-testable.

import type {
  LatexCompileError,
  LatexDocumentPayload,
  LatexFile,
} from '../../../../../types/latex'
import type { ChatTurn, ParsedCodeBlock } from './constants'
import { SYSTEM_PROMPT } from './constants'

export function buildContextMessage(
  files: LatexFile[],
  activeFile: string,
  errors: LatexCompileError[],
  warnings: LatexCompileError[],
  outline: LatexDocumentPayload['outline'],
  rootFile: string,
  userRequest: string,
): string {
  const parts: string[] = []
  // The LLM IPC payload type forbids a `system` role (see
  // LlmMessagePayload in src/types/electron.d.ts). Ship our
  // assistant-specific instruction as a SYSTEM: preamble inside the user
  // message — same trick as src/lib/latex/ai-actions.ts.
  parts.push(`SYSTEM: ${SYSTEM_PROMPT}`)
  parts.push('')
  parts.push('PROJECT FILES:')
  for (const f of files) {
    const marks: string[] = []
    if (f.path === activeFile) marks.push('active')
    if (f.path === rootFile) marks.push('root')
    const tag = marks.length > 0 ? ` [${marks.join(',')}]` : ''
    parts.push(`- ${f.path}${tag}`)
  }
  parts.push('')
  if (outline.length > 0) {
    parts.push('OUTLINE:')
    for (const o of outline) {
      parts.push(`${'#'.repeat(Math.max(1, o.level))} ${o.title} (${o.file})`)
    }
    parts.push('')
  }
  if (errors.length > 0 || warnings.length > 0) {
    parts.push('COMPILE DIAGNOSTICS:')
    for (const e of errors) {
      parts.push(`ERROR ${e.file ?? '?'}:${e.line ?? '?'}  ${e.message}`)
    }
    for (const w of warnings.slice(0, 20)) {
      parts.push(`WARN  ${w.file ?? '?'}:${w.line ?? '?'}  ${w.message}`)
    }
    parts.push('')
  }
  const active = files.find((f) => f.path === activeFile)
  if (active) {
    parts.push(`ACTIVE FILE (${active.path}):`)
    parts.push('```tex')
    parts.push(active.content)
    parts.push('```')
    parts.push('')
  }
  // Include other files too but cap their bodies so the prompt stays cheap.
  for (const f of files) {
    if (f.path === activeFile) continue
    const body = f.content.length > 4000 ? `${f.content.slice(0, 4000)}\n...[truncated]` : f.content
    parts.push(`FILE (${f.path}):`)
    parts.push('```' + (f.kind === 'bib' ? 'bibtex' : 'tex'))
    parts.push(body)
    parts.push('```')
    parts.push('')
  }
  parts.push('USER REQUEST:')
  parts.push(userRequest.trim())
  return parts.join('\n')
}

export function parseCodeBlocks(markdown: string): ParsedCodeBlock[] {
  const out: ParsedCodeBlock[] = []
  const re = /```([^\n]*)\n([\s\S]*?)```/g
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(markdown)) !== null) {
    const info = m[1].trim()
    const pathMatch =
      /(?:^|\s)path\s*=\s*([^\s]+)/i.exec(info) ??
      /(?:^|\s)(\S+\.(?:tex|bib|cls|sty))(?:\s|$)/i.exec(info)
    const language = info.split(/\s+/)[0] || undefined
    out.push({
      index: i++,
      path: pathMatch ? pathMatch[1] : undefined,
      language: language && language !== '' ? language : undefined,
      content: m[2],
    })
  }
  return out
}

export function splitAroundCodeBlocks(markdown: string): Array<
  | { type: 'text'; text: string }
  | { type: 'code'; block: ParsedCodeBlock }
> {
  const out: Array<
    { type: 'text'; text: string } | { type: 'code'; block: ParsedCodeBlock }
  > = []
  const re = /```([^\n]*)\n([\s\S]*?)```/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(markdown)) !== null) {
    if (m.index > last) {
      out.push({ type: 'text', text: markdown.slice(last, m.index) })
    }
    const info = m[1].trim()
    const pathMatch =
      /(?:^|\s)path\s*=\s*([^\s]+)/i.exec(info) ??
      /(?:^|\s)(\S+\.(?:tex|bib|cls|sty))(?:\s|$)/i.exec(info)
    out.push({
      type: 'code',
      block: {
        index: i++,
        path: pathMatch ? pathMatch[1] : undefined,
        language: info.split(/\s+/)[0] || undefined,
        content: m[2],
      },
    })
    last = m.index + m[0].length
  }
  if (last < markdown.length) {
    out.push({ type: 'text', text: markdown.slice(last) })
  }
  return out
}

export function turnId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }
}

/** Collapse back-to-back identical assistant error bubbles (e.g. repeated model hints). */
export function mergeDuplicateConsecutiveAssistantErrors(turns: ChatTurn[]): ChatTurn[] {
  const out: ChatTurn[] = []
  for (const t of turns) {
    const prev = out[out.length - 1]
    if (
      prev &&
      t.role === 'assistant' &&
      prev.role === 'assistant' &&
      t.error &&
      prev.error &&
      t.content.trim() === prev.content.trim()
    ) {
      continue
    }
    out.push(t)
  }
  return out
}

export function isModelSetupMessage(text: string): boolean {
  const s = text.trim().toLowerCase()
  return (
    s.includes('settings → models') ||
    s.includes('settings -> models') ||
    s.includes('ctrl+shift+l') ||
    s.includes('no default model') ||
    s.includes('no llm providers') ||
    s.includes('could not resolve a model')
  )
}
