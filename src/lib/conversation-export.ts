// Session chat export — serialize the active session thread to Markdown or
// JSON and trigger a browser download.

import type { Session, TranscriptMessage } from '../types/session'
import { downloadTextFile } from './pro-export'

export type ExportFormat = 'markdown' | 'json'

/**
 * Entry point for the chat panel's "Export" menu item. Produces a Blob
 * and fires a synthetic anchor click to save it — no Electron IPC
 * dependency, so it works in plain Vite mode too.
 */
export function exportSessionChat(
  session: Session,
  format: ExportFormat,
): void {
  const { content, mime, filename } =
    format === 'markdown'
      ? toMarkdownPayload(session)
      : toJsonPayload(session)
  downloadTextFile(filename, content, mime)
}

/** Serialize the whole session as Markdown without triggering a
 *  download — callers (the "Copy conversation" menu item) pipe the
 *  returned string straight to `navigator.clipboard.writeText`. */
export function serializeSessionAsMarkdown(session: Session): string {
  return toMarkdownPayload(session).content
}

function toMarkdownPayload(session: Session): {
  content: string
  mime: string
  filename: string
} {
  const lines: string[] = []
  lines.push(`# ${session.title}`)
  lines.push('')
  lines.push(`- mode: \`${session.chatMode}\``)
  lines.push(`- created: ${formatDate(session.createdAt)}`)
  lines.push(`- updated: ${formatDate(session.updatedAt)}`)
  lines.push(`- messages: ${session.transcript.length}`)
  if (session.researchState?.reportArtifactId) {
    lines.push(`- report artifact: \`${session.researchState.reportArtifactId}\``)
  }
  lines.push('')
  lines.push('---')
  lines.push('')
  for (const msg of session.transcript) {
    lines.push(formatMessageMarkdown(msg))
    lines.push('')
  }
  return {
    content: lines.join('\n'),
    mime: 'text/markdown;charset=utf-8',
    filename: `${safeFilename(session.title)}.md`,
  }
}

function toJsonPayload(session: Session): {
  content: string
  mime: string
  filename: string
} {
  const body = {
    format: 'lattice-session-chat',
    version: 1,
    exportedAt: Date.now(),
    sessionId: session.id,
    title: session.title,
    chatMode: session.chatMode,
    transcript: session.transcript,
    researchState: session.researchState,
  }
  return {
    content: JSON.stringify(body, null, 2),
    mime: 'application/json;charset=utf-8',
    filename: `${safeFilename(session.title)}.json`,
  }
}

function formatMessageMarkdown(msg: TranscriptMessage): string {
  const role = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'System'
  const ts = formatDate(msg.timestamp)
  const header = `## ${role} · ${ts}`
  return `${header}\n\n${msg.content}`
}

function formatDate(ms: number): string {
  const d = new Date(ms)
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z')
}

function safeFilename(title: string): string {
  return (
    title
      .replace(/[^A-Za-z0-9-_. ]/g, '_')
      .trim()
      .slice(0, 60) || 'session-chat'
  )
}

