import type { IWorkspaceFs } from './fs'
import type { LatticeFileKind } from './fs/types'

export const ENVELOPE_SCHEMA_VERSION = 1

export interface LatticeEnvelope<P = unknown> {
  schemaVersion: number
  kind: LatticeFileKind
  id: string
  createdAt: number
  updatedAt: number
  meta?: Record<string, unknown>
  payload: P
}

export class EnvelopeError extends Error {
  constructor(
    message: string,
    public readonly relPath: string,
  ) {
    super(message)
    this.name = 'EnvelopeError'
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateEnvelope(
  raw: unknown,
  relPath: string,
): LatticeEnvelope<unknown> {
  if (!isPlainObject(raw)) {
    throw new EnvelopeError('File is not a JSON object', relPath)
  }
  if (typeof raw.schemaVersion !== 'number') {
    throw new EnvelopeError('Missing or invalid `schemaVersion`', relPath)
  }
  if (typeof raw.kind !== 'string') {
    throw new EnvelopeError('Missing or invalid `kind`', relPath)
  }
  if (!('payload' in raw)) {
    throw new EnvelopeError('Missing `payload`', relPath)
  }
  const id = typeof raw.id === 'string' ? raw.id : ''
  const createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : 0
  const updatedAt =
    typeof raw.updatedAt === 'number' ? raw.updatedAt : createdAt
  const meta = isPlainObject(raw.meta) ? raw.meta : undefined
  return {
    schemaVersion: raw.schemaVersion,
    kind: raw.kind as LatticeFileKind,
    id,
    createdAt,
    updatedAt,
    meta,
    payload: raw.payload,
  }
}

export async function readEnvelope<P = unknown>(
  fs: IWorkspaceFs,
  relPath: string,
): Promise<LatticeEnvelope<P>> {
  let raw: unknown
  try {
    raw = await fs.readJson<unknown>(relPath)
  } catch (err) {
    throw new EnvelopeError(
      err instanceof Error ? err.message : String(err),
      relPath,
    )
  }
  const env = validateEnvelope(raw, relPath)
  return env as LatticeEnvelope<P>
}

export interface WriteEnvelopeInput<P> {
  kind: LatticeFileKind
  id: string
  createdAt?: number
  updatedAt?: number
  meta?: Record<string, unknown>
  payload: P
}

export async function writeEnvelope<P>(
  fs: IWorkspaceFs,
  relPath: string,
  value: WriteEnvelopeInput<P>,
): Promise<void> {
  const now = Date.now()
  const env: LatticeEnvelope<P> = {
    schemaVersion: ENVELOPE_SCHEMA_VERSION,
    kind: value.kind,
    id: value.id,
    createdAt: value.createdAt ?? now,
    updatedAt: value.updatedAt ?? now,
    meta: value.meta,
    payload: value.payload,
  }
  await fs.writeJson(relPath, env)
}
