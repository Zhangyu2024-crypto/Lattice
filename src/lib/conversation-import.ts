// Inverse of `conversation-export.ts`. Parses either format we emit
// (`exportSessionChat('json')`) or the legacy `.chat.json` envelope
// (kind='chat', payload.messages) and spawns a fresh session in the
// runtime-store. Defensive: any malformed shape reports an error rather
// than throwing — the caller is expected to surface the string via toast.

import type { ConversationMode, TranscriptMessage } from '../types/session'
import { useRuntimeStore } from '../stores/runtime-store'

export interface ImportSuccess {
  ok: true
  sessionId: string
  title: string
  messageCount: number
}
export interface ImportError {
  ok: false
  error: string
}
export type ImportResult = ImportSuccess | ImportError

interface RawExportShape {
  format?: unknown
  version?: unknown
  title?: unknown
  chatMode?: unknown
  transcript?: unknown
  researchState?: unknown
}

interface RawEnvelopeShape {
  kind?: unknown
  payload?: {
    messages?: unknown
    mode?: unknown
    [k: string]: unknown
  }
  [k: string]: unknown
}

function isString(x: unknown): x is string {
  return typeof x === 'string'
}

function coerceMode(raw: unknown): ConversationMode {
  if (raw === 'agent' || raw === 'research' || raw === 'dialog') return raw
  return 'agent'
}

function coerceMessages(raw: unknown): TranscriptMessage[] | null {
  if (!Array.isArray(raw)) return null
  const out: TranscriptMessage[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const m = r as Record<string, unknown>
    const id = isString(m.id) ? m.id : null
    const content = isString(m.content) ? m.content : ''
    const timestamp =
      typeof m.timestamp === 'number' && Number.isFinite(m.timestamp)
        ? m.timestamp
        : Date.now()
    const role =
      m.role === 'user' || m.role === 'assistant' || m.role === 'system'
        ? m.role
        : null
    if (!id || !role) continue
    const msg: TranscriptMessage = { id, role, content, timestamp }
    if (
      m.status === 'streaming' ||
      m.status === 'complete' ||
      m.status === 'error'
    ) {
      msg.status = m.status
    }
    out.push(msg)
  }
  return out
}

export function importConversationFromText(text: string): ImportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    return { ok: false, error: `Not valid JSON: ${err instanceof Error ? err.message : String(err)}` }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'File is not a JSON object.' }
  }

  // Shape A: our own export format.
  const asExport = parsed as RawExportShape
  if (asExport.format === 'lattice-session-chat') {
    const title = isString(asExport.title) ? asExport.title : 'Imported chat'
    const mode = coerceMode(asExport.chatMode)
    const messages = coerceMessages(asExport.transcript)
    if (!messages) {
      return { ok: false, error: 'Export is missing a transcript array.' }
    }
    return spawnFromMessages(title, mode, messages)
  }

  // Shape B: workspace `.chat.json` envelope (kind='chat').
  const asEnvelope = parsed as RawEnvelopeShape
  if (asEnvelope.kind === 'chat' && asEnvelope.payload) {
    const title =
      isString(asEnvelope.meta && (asEnvelope.meta as Record<string, unknown>).title)
        ? (asEnvelope.meta as { title: string }).title
        : 'Imported chat'
    const mode = coerceMode(asEnvelope.payload.mode)
    const messages = coerceMessages(asEnvelope.payload.messages)
    if (!messages) {
      return { ok: false, error: 'Envelope payload is missing messages.' }
    }
    return spawnFromMessages(title, mode, messages)
  }

  return {
    ok: false,
    error:
      'Unrecognized chat format — expected a Lattice export (format: "lattice-session-chat") or a .chat.json envelope.',
  }
}

function spawnFromMessages(
  title: string,
  mode: ConversationMode,
  messages: TranscriptMessage[],
): ImportResult {
  const rt = useRuntimeStore.getState()
  const sessionId = rt.createSession({ title })
  if (mode !== 'agent') rt.setChatMode(sessionId, mode)
  for (const msg of messages) {
    rt.appendTranscript(sessionId, msg)
  }
  rt.setActiveSession(sessionId)
  return { ok: true, sessionId, title, messageCount: messages.length }
}
