import type { IWorkspaceFs } from './fs'
import { readEnvelope, writeEnvelope } from './envelope'
import { genShortId } from '../id-gen'
import type {
  PeakFitPayload,
  SpectrumPayload,
} from '../../types/artifact'
import type {
  ConversationMode,
  TranscriptMessage,
} from '../../types/session'

const SPECTRUM_DIR = 'raw'
const ANALYSIS_DIR = 'analysis'
const SPECTRUM_SUFFIX = '.spectrum.json'
const PEAKFIT_SUFFIX = '.peakfit.json'

/**
 * Wire-compatible shape of a `.chat.json` envelope's payload. Mirrors the
 * fields `ChatFileEditor` reads and `FileContextMenu`'s "New Chat" writes.
 * `mentions` is a loosely-typed pass-through; the chat renderer does its
 * own per-item normalization.
 */
export interface ChatFilePayload {
  messages: TranscriptMessage[]
  mentions: unknown[]
  mode: ConversationMode
  model: string | null
}

export interface PersistSpectrumHint {
  /** Source filename reported by the backend (may include an extension). */
  sourceFile?: string | null
}

export interface PersistPeaksHint {
  /** Source raw-data filename; used to derive a sibling analysis filename. */
  sourceFile?: string | null
  /** Relative path of the spectrum envelope the peak fit belongs to. */
  spectrumRel?: string | null
}

/**
 * Sanitize an arbitrary string into a filesystem-safe basename.
 * - Strips directory separators and any already-present `.spectrum.json`
 *   / `.peakfit.json` suffix so we can append the canonical suffix cleanly.
 * - Replaces characters that are hostile on Windows / shell-unfriendly
 *   with underscores.
 * - Collapses whitespace and trims leading/trailing dots.
 */
function sanitizeBasename(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const lastSlash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  const lastSegment = lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed
  let base = lastSegment
  const lower = base.toLowerCase()
  if (lower.endsWith(SPECTRUM_SUFFIX)) {
    base = base.slice(0, base.length - SPECTRUM_SUFFIX.length)
  } else if (lower.endsWith(PEAKFIT_SUFFIX)) {
    base = base.slice(0, base.length - PEAKFIT_SUFFIX.length)
  } else {
    const dot = base.lastIndexOf('.')
    if (dot > 0) base = base.slice(0, dot)
  }
  return base
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 120)
}

function pickSourceName(
  hintFile: string | null | undefined,
  payloadFallback?: string | null,
): string | null {
  if (typeof hintFile === 'string' && hintFile.trim().length > 0) return hintFile
  if (typeof payloadFallback === 'string' && payloadFallback.trim().length > 0) {
    return payloadFallback
  }
  return null
}

function genId(prefix: string): string {
  return genShortId(prefix, 6)
}

async function ensureDir(fs: IWorkspaceFs, rel: string): Promise<void> {
  try {
    await fs.mkdir(rel)
  } catch {
    // mkdir is expected to be idempotent on the backend; swallow "already
    // exists" style errors so pushes never drop a file just because the
    // directory happens to predate the push.
  }
}

export async function persistSpectrumUpdate(
  fs: IWorkspaceFs,
  payload: SpectrumPayload,
  hint?: PersistSpectrumHint,
): Promise<string> {
  const source = pickSourceName(hint?.sourceFile)
  const sanitized = source ? sanitizeBasename(source) : ''
  const base = sanitized || `spectrum-${Date.now()}`
  const relPath = `${SPECTRUM_DIR}/${base}${SPECTRUM_SUFFIX}`

  await ensureDir(fs, SPECTRUM_DIR)
  await writeEnvelope<SpectrumPayload>(fs, relPath, {
    kind: 'spectrum',
    id: genId('spectrum'),
    payload,
    meta: source ? { sourceFile: source } : undefined,
  })
  return relPath
}

export async function persistPeaksUpdate(
  fs: IWorkspaceFs,
  payload: PeakFitPayload,
  hint?: PersistPeaksHint,
): Promise<string> {
  const source = pickSourceName(hint?.sourceFile)
  let base = source ? sanitizeBasename(source) : ''
  if (!base && hint?.spectrumRel) {
    const segment = hint.spectrumRel.split('/').pop() ?? hint.spectrumRel
    base = sanitizeBasename(segment)
  }
  if (!base) base = `peaks-${Date.now()}`
  const relPath = `${ANALYSIS_DIR}/${base}${PEAKFIT_SUFFIX}`

  await ensureDir(fs, ANALYSIS_DIR)
  const meta: Record<string, unknown> = {}
  if (source) meta.sourceFile = source
  if (hint?.spectrumRel) meta.spectrumRel = hint.spectrumRel

  await writeEnvelope<PeakFitPayload>(fs, relPath, {
    kind: 'peakfit',
    id: genId('peakfit'),
    payload,
    meta: Object.keys(meta).length > 0 ? meta : undefined,
  })
  return relPath
}

// ---------------------------------------------------------------------------
// Chat streaming — Phase 4b
// ---------------------------------------------------------------------------
//
// `chat_message` / `chat_message_update` deliver transcript mutations at
// token granularity. Writing the envelope on every delta would swamp the
// filesystem and chokidar, so we stage the full payload in workspace-store's
// `dirtyBuffer` and only flush to disk when the frame is terminal
// (`complete`). ChatFileEditor subscribes to the dirtyBuffer slot for
// real-time rendering; the flush step is what non-streaming callers (file
// reopen, reload, other editors) will see.

function isChatPayload(v: unknown): v is ChatFilePayload {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const obj = v as Record<string, unknown>
  return Array.isArray(obj.messages)
}

function cloneMessages(messages: TranscriptMessage[]): TranscriptMessage[] {
  // Shallow clone is enough: callers treat messages as immutable objects, so
  // sharing nested refs is safe and avoids a deep-clone hot loop on every
  // streaming token.
  return messages.slice()
}

function emptyChatPayload(): ChatFilePayload {
  return { messages: [], mentions: [], mode: 'dialog', model: null }
}

/**
 * Load the current chat payload from the dirty buffer (hot path) or, failing
 * that, from disk. Returns an empty payload if the file does not yet exist
 * on disk and the buffer is empty — the caller is expected to seed it.
 */
async function loadChatPayload(
  fs: IWorkspaceFs,
  chatRel: string,
  dirtyBufferGet: () => unknown | undefined,
): Promise<ChatFilePayload> {
  const buffered = dirtyBufferGet()
  if (isChatPayload(buffered)) {
    return {
      messages: buffered.messages,
      mentions: Array.isArray(buffered.mentions) ? buffered.mentions : [],
      mode: buffered.mode ?? 'dialog',
      model: buffered.model ?? null,
    }
  }
  try {
    const env = await readEnvelope<unknown>(fs, chatRel)
    if (isChatPayload(env.payload)) {
      return {
        messages: env.payload.messages,
        mentions: Array.isArray(env.payload.mentions)
          ? env.payload.mentions
          : [],
        mode: env.payload.mode ?? 'dialog',
        model: env.payload.model ?? null,
      }
    }
  } catch {
    // Missing or malformed envelope — fall through to a fresh payload. The
    // first `persistChatMessage` will bootstrap the file on its terminal
    // flush.
  }
  return emptyChatPayload()
}

/**
 * Flush `payload` to `chatRel` as a chat envelope, preserving the original
 * `id` / `createdAt` when the file already exists. Errors are re-thrown so
 * the caller can decide whether to retry; the helper does not touch the
 * dirty buffer.
 */
async function writeChatEnvelope(
  fs: IWorkspaceFs,
  chatRel: string,
  payload: ChatFilePayload,
): Promise<void> {
  let createdAt: number | undefined
  let id: string | undefined
  let meta: Record<string, unknown> | undefined
  try {
    const existing = await readEnvelope<unknown>(fs, chatRel)
    createdAt = existing.createdAt
    id = existing.id
    meta = existing.meta
  } catch {
    // New file — `writeEnvelope` will stamp createdAt/updatedAt itself.
  }
  await writeEnvelope<ChatFilePayload>(fs, chatRel, {
    kind: 'chat',
    id: id || genId('chat'),
    createdAt,
    updatedAt: Date.now(),
    meta,
    payload,
  })
}

/**
 * Append `newMessage` to the chat file's transcript, staging the result in
 * dirtyBuffer. When `complete` is true the envelope is written to disk and
 * the dirty slot is cleared. A disk-write failure is logged but does not
 * throw — the dirty buffer is preserved so the next terminal frame can retry.
 */
export async function persistChatMessage(
  fs: IWorkspaceFs,
  chatRel: string,
  newMessage: TranscriptMessage,
  dirtyBufferGet: () => unknown | undefined,
  setDirty: (data: unknown) => void,
  clearDirty: () => void,
  complete: boolean,
): Promise<void> {
  const current = await loadChatPayload(fs, chatRel, dirtyBufferGet)

  // Idempotent append — the backend may replay the tail of the chat log on
  // WS reconnect, so dedup by message id.
  const existsIdx = current.messages.findIndex((m) => m.id === newMessage.id)
  const nextMessages = cloneMessages(current.messages)
  if (existsIdx >= 0) {
    nextMessages[existsIdx] = { ...nextMessages[existsIdx], ...newMessage }
  } else {
    nextMessages.push(newMessage)
  }

  const nextPayload: ChatFilePayload = {
    messages: nextMessages,
    mentions: current.mentions,
    mode: current.mode,
    model: current.model,
  }
  setDirty(nextPayload)

  if (complete) {
    try {
      await writeChatEnvelope(fs, chatRel, nextPayload)
      clearDirty()
    } catch (err) {
      console.error('[persistChatMessage] envelope write failed', chatRel, err)
      // Intentionally keep dirtyBuffer populated so the next complete frame
      // (or a retry) can still flush.
    }
  }
}

/**
 * Merge `updates` into the transcript message identified by `messageId`.
 * Streaming ordering is not guaranteed; if the target message is not yet in
 * the buffer (update arrived before the corresponding `chat_message`), this
 * is a silent no-op — the next `persistChatMessage` will create the message
 * and, if this update carried terminal data, the backend will usually re-
 * emit it.
 */
export async function persistChatMessageUpdate(
  fs: IWorkspaceFs,
  chatRel: string,
  messageId: string,
  updates: Partial<TranscriptMessage>,
  dirtyBufferGet: () => unknown | undefined,
  setDirty: (data: unknown) => void,
  clearDirty: () => void,
  complete: boolean,
): Promise<void> {
  const current = await loadChatPayload(fs, chatRel, dirtyBufferGet)
  const idx = current.messages.findIndex((m) => m.id === messageId)
  if (idx < 0) {
    // Out-of-order delivery — skip rather than synthesize a placeholder.
    return
  }

  const nextMessages = cloneMessages(current.messages)
  const prev = nextMessages[idx]
  // `content_delta` semantics belong to the WS layer; this helper just
  // receives the resolved patch. Shallow merge is the right granularity
  // because TranscriptMessage fields are either primitives or arrays we
  // want to replace wholesale (artifactRefs, mentions).
  nextMessages[idx] = { ...prev, ...updates }

  const nextPayload: ChatFilePayload = {
    messages: nextMessages,
    mentions: current.mentions,
    mode: current.mode,
    model: current.model,
  }
  setDirty(nextPayload)

  if (complete) {
    try {
      await writeChatEnvelope(fs, chatRel, nextPayload)
      clearDirty()
    } catch (err) {
      console.error(
        '[persistChatMessageUpdate] envelope write failed',
        chatRel,
        err,
      )
    }
  }
}
