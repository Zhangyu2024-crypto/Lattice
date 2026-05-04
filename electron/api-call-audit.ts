import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createGzip, type Gzip } from 'node:zlib'

export type ApiCallAuditStatus =
  | 'accepted'
  | 'ok'
  | 'error'
  | 'cancelled'
  | 'dropped'

export interface ApiCallAuditEvent {
  kind: string
  source?: string
  operation?: string
  status?: ApiCallAuditStatus
  durationMs?: number
  sessionId?: string | null
  taskId?: string
  stepId?: string
  workspaceRoot?: string | null
  request?: unknown
  response?: unknown
  error?: unknown
  meta?: Record<string, unknown>
}

export interface ApiCallAuditConfig {
  dir: string
  enabled?: boolean
  flushIntervalMs?: number
  maxBatchBytes?: number
  maxQueueEntries?: number
  maxFileBytes?: number
}

interface ActiveLog {
  gzip: Gzip
  file: WriteStream
  bytes: number
}

const DEFAULT_FLUSH_INTERVAL_MS = 250
const DEFAULT_MAX_BATCH_BYTES = 256 * 1024
const DEFAULT_MAX_QUEUE_ENTRIES = 50_000
const DEFAULT_MAX_FILE_BYTES = 64 * 1024 * 1024

const REDACTED_KEYS = new Set([
  'apikey',
  'api_key',
  'authorization',
  'approvaltoken',
  'token',
  'password',
  'secret',
  'accesskey',
  'access_key',
  'roomaccesskey',
  'base64',
  'pdf',
  'bytes',
])

const CONTENT_KEYS = new Set([
  'body',
  'code',
  'content',
  'filecontent',
  'html',
  'messages',
  'raw',
  'source',
  'stdout',
  'stderr',
  'systemprompt',
  'text',
])

let config: Required<Omit<ApiCallAuditConfig, 'dir'>> & { dir: string } | null =
  null
let active: ActiveLog | null = null
let flushTimer: NodeJS.Timeout | null = null
let waitingDrain = false
let sequence = 0
let dropped = 0
let queuedBytes = 0
const queue: string[] = []

export function configureApiCallAudit(next: ApiCallAuditConfig): void {
  closeActiveLog()
  queue.length = 0
  queuedBytes = 0
  dropped = 0
  sequence = 0
  config = {
    dir: next.dir,
    enabled: next.enabled ?? true,
    flushIntervalMs: next.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
    maxBatchBytes: next.maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES,
    maxQueueEntries: next.maxQueueEntries ?? DEFAULT_MAX_QUEUE_ENTRIES,
    maxFileBytes: next.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
  }
  if (!config.enabled) return
  try {
    mkdirSync(config.dir, { recursive: true })
    active = openNewLog()
  } catch (err) {
    console.warn(
      '[audit] disabled: failed to initialise audit writer:',
      err instanceof Error ? err.message : String(err),
    )
    config = { ...config, enabled: false }
  }
}

export function recordApiCall(event: ApiCallAuditEvent): void {
  if (!config?.enabled) return
  try {
    const normalized = normalizeEvent(event)
    const line = `${JSON.stringify(normalized)}\n`
    if (queue.length >= config.maxQueueEntries) {
      dropped += 1
      return
    }
    queue.push(line)
    queuedBytes += Buffer.byteLength(line, 'utf8')
    if (queuedBytes >= config.maxBatchBytes) {
      scheduleFlush(0)
    } else {
      scheduleFlush(config.flushIntervalMs)
    }
  } catch (err) {
    console.warn(
      '[audit] dropped malformed event:',
      err instanceof Error ? err.message : String(err),
    )
  }
}

export function flushApiCallAudit(): void {
  flushNow()
}

export async function shutdownApiCallAudit(): Promise<void> {
  flushNow()
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  await closeActiveLogAsync()
}

export function summarizeForAudit(value: unknown): unknown {
  return sanitize(value, 0)
}

export function summarizeErrorForAudit(err: unknown): unknown {
  if (err instanceof Error) {
    const withCode = err as Error & { code?: unknown; status?: unknown }
    return {
      name: err.name,
      message: truncateString(err.message, 512),
      code: typeof withCode.code === 'string' ? withCode.code : undefined,
      status: typeof withCode.status === 'number' ? withCode.status : undefined,
    }
  }
  return sanitize(err, 0)
}

function normalizeEvent(event: ApiCallAuditEvent): Record<string, unknown> {
  sequence += 1
  return {
    v: 1,
    seq: sequence,
    ts: new Date().toISOString(),
    pid: process.pid,
    kind: event.kind,
    source: event.source,
    operation: event.operation,
    status: event.status ?? 'ok',
    durationMs:
      typeof event.durationMs === 'number' && Number.isFinite(event.durationMs)
        ? Math.max(0, Math.round(event.durationMs))
        : undefined,
    sessionId: event.sessionId ?? undefined,
    taskId: event.taskId,
    stepId: event.stepId,
    workspaceRoot: event.workspaceRoot ?? undefined,
    request: sanitize(event.request, 0),
    response: sanitize(event.response, 0),
    error: summarizeErrorForAudit(event.error),
    meta: sanitize(event.meta, 0),
  }
}

function scheduleFlush(delayMs: number): void {
  if (flushTimer) {
    if (delayMs === 0) {
      clearTimeout(flushTimer)
      flushTimer = null
    } else {
      return
    }
  }
  flushTimer = setTimeout(() => {
    flushTimer = null
    flushNow()
  }, delayMs)
  flushTimer.unref?.()
}

function flushNow(): void {
  if (!config?.enabled || waitingDrain || queue.length === 0) return
  if (!active) {
    try {
      active = openNewLog()
    } catch {
      return
    }
  }

  const batch: string[] = []
  let batchBytes = 0
  if (dropped > 0) {
    const line = `${JSON.stringify({
      v: 1,
      seq: ++sequence,
      ts: new Date().toISOString(),
      pid: process.pid,
      kind: 'audit.queue_overflow',
      source: 'audit',
      status: 'dropped',
      response: { dropped },
    })}\n`
    batch.push(line)
    batchBytes += Buffer.byteLength(line, 'utf8')
    dropped = 0
  }

  while (queue.length > 0 && batchBytes < config.maxBatchBytes) {
    const line = queue.shift()
    if (!line) break
    queuedBytes -= Buffer.byteLength(line, 'utf8')
    batch.push(line)
    batchBytes += Buffer.byteLength(line, 'utf8')
  }
  if (batch.length === 0) return

  if (active.bytes >= config.maxFileBytes) {
    rotateLog()
  }
  if (!active) active = openNewLog()

  const chunk = batch.join('')
  active.bytes += Buffer.byteLength(chunk, 'utf8')
  const ok = active.gzip.write(chunk, 'utf8')
  if (!ok) {
    waitingDrain = true
    active.gzip.once('drain', () => {
      waitingDrain = false
      if (queue.length > 0) scheduleFlush(0)
    })
  }
  if (active.bytes >= config.maxFileBytes) rotateLog()
  if (queue.length > 0 && !waitingDrain) scheduleFlush(0)
}

function openNewLog(): ActiveLog {
  if (!config) throw new Error('audit writer not configured')
  mkdirSync(config.dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filePath = path.join(
    config.dir,
    `api-calls-${stamp}-${process.pid}.ndjson.gz`,
  )
  const file = createWriteStream(filePath, { flags: 'wx' })
  file.on('error', (err) => {
    console.warn('[audit] write stream error:', err.message)
  })
  const gzip = createGzip({ level: 6 })
  gzip.on('error', (err) => {
    console.warn('[audit] gzip stream error:', err.message)
  })
  gzip.pipe(file)
  return { gzip, file, bytes: 0 }
}

function rotateLog(): void {
  closeActiveLog()
  active = openNewLog()
}

function closeActiveLog(): void {
  if (!active) return
  try {
    active.gzip.end()
  } catch {
    // best effort on shutdown / reconfigure
  }
  active = null
  waitingDrain = false
}

function closeActiveLogAsync(): Promise<void> {
  if (!active) return Promise.resolve()
  const closing = active
  active = null
  waitingDrain = false
  return new Promise((resolve) => {
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      resolve()
    }
    closing.file.once('close', finish)
    closing.file.once('finish', finish)
    closing.file.once('error', finish)
    closing.gzip.once('error', finish)
    try {
      closing.gzip.end()
    } catch {
      finish()
    }
  })
}

function sanitize(value: unknown, depth: number): unknown {
  if (value == null) return value
  if (depth > 5) return '[depth-limit]'
  if (typeof value === 'string') return summarizeString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (ArrayBuffer.isView(value)) {
    return { type: value.constructor.name, bytes: value.byteLength }
  }
  if (value instanceof ArrayBuffer) {
    return { type: 'ArrayBuffer', bytes: value.byteLength }
  }
  if (Array.isArray(value)) {
    const max = 20
    return {
      count: value.length,
      items: value.slice(0, max).map((item) => sanitize(item, depth + 1)),
      ...(value.length > max ? { truncated: value.length - max } : {}),
    }
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    let count = 0
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      count += 1
      if (count > 80) {
        out.__truncatedKeys = count - 80
        break
      }
      const normalized = key.toLowerCase().replace(/[^a-z0-9_]/g, '')
      if (REDACTED_KEYS.has(normalized)) {
        out[key] = '[redacted]'
      } else if (
        CONTENT_KEYS.has(normalized) &&
        (typeof raw === 'string' ||
          raw instanceof ArrayBuffer ||
          ArrayBuffer.isView(raw))
      ) {
        out[key] = summarizeString(raw, 0)
      } else {
        out[key] = sanitize(raw, depth + 1)
      }
    }
    return out
  }
  return String(value)
}

function summarizeString(
  value: string | ArrayBuffer | ArrayBufferView,
  previewChars = 160,
): unknown {
  if (value instanceof ArrayBuffer) {
    return {
      type: 'ArrayBuffer',
      bytes: value.byteLength,
      sha256: createHash('sha256').update(new Uint8Array(value)).digest('hex'),
    }
  }
  if (ArrayBuffer.isView(value)) {
    const buf = Buffer.from(value.buffer, value.byteOffset, value.byteLength)
    return {
      type: value.constructor.name,
      bytes: value.byteLength,
      sha256: createHash('sha256').update(buf).digest('hex'),
    }
  }
  const bytes = Buffer.byteLength(value, 'utf8')
  if (value.length <= previewChars && bytes <= 512) return value
  return {
    type: 'string',
    chars: value.length,
    bytes,
    sha256: createHash('sha256').update(value).digest('hex'),
    ...(previewChars > 0 ? { preview: truncateString(value, previewChars) } : {}),
  }
}

function truncateString(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}...`
}
