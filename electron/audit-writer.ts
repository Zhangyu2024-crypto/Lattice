import { app } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'

const LOG_DIR_REL = path.join('logs', 'api-calls')
const MAX_INLINE_STRING_BYTES = 2048
const MAX_ARRAY_ITEMS = 32
const MAX_OBJECT_KEYS = 64
const MAX_DEPTH = 6
const DEFAULT_RETENTION_DAYS = 30
const MIN_RETENTION_DAYS = 1
const MAX_RETENTION_DAYS = 365
const WRITE_QUEUE_LIMIT = 512

const SENSITIVE_KEY_RE =
  /(?:api[_-]?key|authorization|approval[_-]?token|password|passwd|secret|access[_-]?token|refresh[_-]?token|id[_-]?token|cookie|session[_-]?token|bearer|private[_-]?key)/i

export type AuditCategory =
  | 'llm'
  | 'workspace'
  | 'creator'
  | 'agent_tool'
  | 'plugin'
  | 'mcp'
  | 'compute'
  | 'system'

export interface AuditEventInput {
  category: AuditCategory
  action: string
  status?: 'started' | 'success' | 'error' | 'denied' | 'aborted'
  metadata?: Record<string, unknown>
  error?: unknown
  durationMs?: number
  requestId?: string
  traceId?: string
}

export interface AuditConfig {
  enabled: boolean
  acceptedAgreementVersion: string | null
  currentAgreementVersion: string
  retentionDays: number
}

export interface AuditStatus {
  enabled: boolean
  acceptedAgreementVersion: string | null
  currentAgreementVersion: string
  retentionDays: number
  logDir: string
}

export interface SanitizedLargeValue {
  type: 'text' | 'binary'
  length: number
  sha256: string
}

let config: AuditConfig = {
  enabled: false,
  acceptedAgreementVersion: null,
  currentAgreementVersion: 'unknown',
  retentionDays: DEFAULT_RETENTION_DAYS,
}

let writeQueue: Promise<void> = Promise.resolve()
let queuedWrites = 0
let lastCleanupAt = 0

function clampRetentionDays(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_RETENTION_DAYS
  return Math.round(Math.max(MIN_RETENTION_DAYS, Math.min(MAX_RETENTION_DAYS, value)))
}

function hashBuffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

function summarizeString(value: string): string | SanitizedLargeValue {
  const buf = Buffer.from(value, 'utf8')
  if (buf.byteLength <= MAX_INLINE_STRING_BYTES) return value
  return {
    type: 'text',
    length: buf.byteLength,
    sha256: hashBuffer(buf),
  }
}

export function summarizeTextForAudit(value: string): SanitizedLargeValue {
  const buf = Buffer.from(value, 'utf8')
  return {
    type: 'text',
    length: buf.byteLength,
    sha256: hashBuffer(buf),
  }
}

function summarizeBinary(value: ArrayBuffer | ArrayBufferView | Buffer): SanitizedLargeValue {
  let buf: Buffer
  if (Buffer.isBuffer(value)) {
    buf = value
  } else if (value instanceof ArrayBuffer) {
    buf = Buffer.from(new Uint8Array(value))
  } else {
    buf = Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  }
  return {
    type: 'binary',
    length: buf.byteLength,
    sha256: hashBuffer(buf),
  }
}

export function summarizePayloadForAudit(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[max-depth]'
  if (value == null) return value
  if (typeof value === 'string') return summarizeTextForAudit(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'function' || typeof value === 'symbol') return `[${typeof value}]`
  if (value instanceof Date) return value.toISOString()
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value) || Buffer.isBuffer(value)) {
    return summarizeBinary(value as ArrayBuffer | ArrayBufferView | Buffer)
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) =>
      summarizePayloadForAudit(item, depth + 1),
    )
    if (value.length > MAX_ARRAY_ITEMS) {
      items.push({ omittedItems: value.length - MAX_ARRAY_ITEMS })
    }
    return items
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    const entries = Object.entries(value as Record<string, unknown>)
    for (const [key, item] of entries.slice(0, MAX_OBJECT_KEYS)) {
      if (SENSITIVE_KEY_RE.test(key)) {
        out[key] = '[redacted]'
      } else {
        out[key] = summarizePayloadForAudit(item, depth + 1)
      }
    }
    if (entries.length > MAX_OBJECT_KEYS) {
      out.__omittedKeys = entries.length - MAX_OBJECT_KEYS
    }
    return out
  }
  return String(value)
}

function errorToSafeObject(error: unknown): Record<string, unknown> | undefined {
  if (error == null) return undefined
  if (error instanceof Error) {
    return {
      name: error.name,
      message: summarizeTextForAudit(error.message),
    }
  }
  if (typeof error === 'string') {
    return { message: summarizeTextForAudit(error) }
  }
  return sanitizeAuditValue(error) as Record<string, unknown>
}

export function sanitizeAuditValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[max-depth]'
  if (value == null) return value
  if (typeof value === 'string') return summarizeString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'function' || typeof value === 'symbol') return `[${typeof value}]`
  if (value instanceof Date) return value.toISOString()
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value) || Buffer.isBuffer(value)) {
    return summarizeBinary(value as ArrayBuffer | ArrayBufferView | Buffer)
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) =>
      sanitizeAuditValue(item, depth + 1),
    )
    if (value.length > MAX_ARRAY_ITEMS) {
      items.push({ omittedItems: value.length - MAX_ARRAY_ITEMS })
    }
    return items
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    const entries = Object.entries(value as Record<string, unknown>)
    for (const [key, item] of entries.slice(0, MAX_OBJECT_KEYS)) {
      if (SENSITIVE_KEY_RE.test(key)) {
        out[key] = '[redacted]'
      } else {
        out[key] = sanitizeAuditValue(item, depth + 1)
      }
    }
    if (entries.length > MAX_OBJECT_KEYS) {
      out.__omittedKeys = entries.length - MAX_OBJECT_KEYS
    }
    return out
  }
  return String(value)
}

export function getAuditLogDir(): string {
  return path.join(app.getPath('userData'), LOG_DIR_REL)
}

function isEnabled(): boolean {
  return (
    config.enabled === true &&
    config.acceptedAgreementVersion === config.currentAgreementVersion
  )
}

export function getAuditStatus(): AuditStatus {
  return {
    enabled: isEnabled(),
    acceptedAgreementVersion: config.acceptedAgreementVersion,
    currentAgreementVersion: config.currentAgreementVersion,
    retentionDays: config.retentionDays,
    logDir: getAuditLogDir(),
  }
}

export function configureAudit(next: Partial<AuditConfig>): AuditStatus {
  config = {
    ...config,
    ...next,
    acceptedAgreementVersion:
      typeof next.acceptedAgreementVersion === 'string'
        ? next.acceptedAgreementVersion
        : next.acceptedAgreementVersion === null
          ? null
          : config.acceptedAgreementVersion,
    currentAgreementVersion:
      typeof next.currentAgreementVersion === 'string' &&
      next.currentAgreementVersion.length > 0
        ? next.currentAgreementVersion
        : config.currentAgreementVersion,
    retentionDays: clampRetentionDays(next.retentionDays ?? config.retentionDays),
    enabled: next.enabled === undefined ? config.enabled : next.enabled === true,
  }
  return getAuditStatus()
}

async function cleanupOldLogs(now: number): Promise<void> {
  if (now - lastCleanupAt < 60 * 60 * 1000) return
  lastCleanupAt = now
  const dir = getAuditLogDir()
  const cutoff = now - config.retentionDays * 24 * 60 * 60 * 1000
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return
  }
  await Promise.allSettled(
    entries
      .filter((name) => /^audit-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
      .map(async (name) => {
        const abs = path.join(dir, name)
        const info = await stat(abs)
        if (info.mtimeMs < cutoff) await rm(abs, { force: true })
      }),
  )
}

async function writeEventNow(input: AuditEventInput): Promise<void> {
  const now = Date.now()
  const date = new Date(now)
  const dir = getAuditLogDir()
  await mkdir(dir, { recursive: true })
  await cleanupOldLogs(now)
  const record = {
    id: input.requestId ?? randomUUID(),
    trace_id:
      input.traceId ??
      (typeof input.metadata?.trace_id === 'string'
        ? input.metadata.trace_id
        : undefined),
    timestamp: date.toISOString(),
    category: input.category,
    action: input.action,
    status: input.status ?? 'success',
    durationMs:
      typeof input.durationMs === 'number' && Number.isFinite(input.durationMs)
        ? Math.max(0, Math.round(input.durationMs))
        : undefined,
    metadata: sanitizeAuditValue(input.metadata ?? {}),
    error: errorToSafeObject(input.error),
  }
  const day = date.toISOString().slice(0, 10)
  await appendFile(path.join(dir, `audit-${day}.jsonl`), `${JSON.stringify(record)}\n`, 'utf8')
}

export function writeAuditEvent(input: AuditEventInput): void {
  if (!isEnabled()) return
  if (queuedWrites >= WRITE_QUEUE_LIMIT) return
  queuedWrites += 1
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(() => writeEventNow(input))
    .catch((err) => {
      console.warn('[Lattice] audit write failed:', err instanceof Error ? err.message : String(err))
    })
    .finally(() => {
      queuedWrites = Math.max(0, queuedWrites - 1)
    })
}

export async function flushAuditEvents(): Promise<void> {
  await writeQueue.catch(() => undefined)
}

export async function clearAuditLogs(): Promise<void> {
  await flushAuditEvents()
  await rm(getAuditLogDir(), { recursive: true, force: true })
}
