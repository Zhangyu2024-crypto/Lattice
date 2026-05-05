import { createHash, randomUUID } from 'node:crypto'
import type { LlmInvokeRequest, LlmListModelsRequest, LlmTestConnectionRequest } from './llm-proxy'
import { getCurrentWorkspaceRoot } from './ipc-workspace-root'

export type LatticeTraceModule =
  | 'agent'
  | 'creator'
  | 'latex'
  | 'workspace'
  | 'compute'
  | 'research'
  | 'library'

export type LatticeTraceOperation =
  | 'chat'
  | 'latex_edit_selection'
  | 'latex_fix_compile_error'
  | 'workspace_bash_explain'
  | 'research_draft_section'
  | 'creator_generate'
  | 'tool_result_summarize'
  | (string & {})

export interface LatticeTraceContext {
  traceId: string
  module: LatticeTraceModule
  operation: LatticeTraceOperation
  sessionId: string | null
  artifactId: string | null
  workspaceIdHash: string | null
  consentVersion: string | null
}

type TraceCarrier = Partial<{
  traceId: unknown
  module: unknown
  operation: unknown
  sessionId: unknown
  artifactId: unknown
  workspaceIdHash: unknown
  consentVersion: unknown
  mode: unknown
}>

const VALID_MODULES = new Set<LatticeTraceModule>([
  'agent',
  'creator',
  'latex',
  'workspace',
  'compute',
  'research',
  'library',
])

export function hashWorkspaceId(rootPath: string | null | undefined): string | null {
  if (!rootPath) return null
  return createHash('sha256').update(rootPath).digest('hex')
}

function cleanHeaderValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.replace(/[\r\n]/g, '').slice(0, 256)
}

function normalizeModule(value: unknown, fallback: LatticeTraceModule): LatticeTraceModule {
  const cleaned = cleanHeaderValue(value)
  if (cleaned && VALID_MODULES.has(cleaned as LatticeTraceModule)) {
    return cleaned as LatticeTraceModule
  }
  return fallback
}

function normalizeOperation(value: unknown, fallback: LatticeTraceOperation): LatticeTraceOperation {
  return cleanHeaderValue(value) ?? fallback
}

function inferModule(req: TraceCarrier): LatticeTraceModule {
  if (req.mode === 'agent') return 'agent'
  return 'agent'
}

function inferOperation(req: TraceCarrier): LatticeTraceOperation {
  return 'chat'
}

export function buildLatticeTraceContext(
  req: TraceCarrier,
): LatticeTraceContext {
  const fallbackModule = inferModule(req)
  const workspaceIdHash =
    cleanHeaderValue(req.workspaceIdHash) ?? hashWorkspaceId(getCurrentWorkspaceRoot())
  return {
    traceId: cleanHeaderValue(req.traceId) ?? randomUUID(),
    module: normalizeModule(req.module, fallbackModule),
    operation: normalizeOperation(req.operation, inferOperation(req)),
    sessionId: cleanHeaderValue(req.sessionId),
    artifactId: cleanHeaderValue(req.artifactId),
    workspaceIdHash,
    consentVersion: cleanHeaderValue(req.consentVersion),
  }
}

export function latticeTraceHeaders(
  trace: LatticeTraceContext,
): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Lattice-Trace-Id': trace.traceId,
    'X-Lattice-Module': trace.module,
    'X-Lattice-Operation': trace.operation,
  }
  if (trace.sessionId) headers['X-Lattice-Session-Id'] = trace.sessionId
  if (trace.artifactId) headers['X-Lattice-Artifact-Id'] = trace.artifactId
  if (trace.workspaceIdHash) {
    headers['X-Lattice-Workspace-Id-Hash'] = trace.workspaceIdHash
  }
  if (trace.consentVersion) {
    headers['X-Lattice-Consent-Version'] = trace.consentVersion
  }
  return headers
}

export function latticeTraceAuditMetadata(
  trace: LatticeTraceContext,
): Record<string, string | null> {
  return {
    trace_id: trace.traceId,
    module: trace.module,
    operation: trace.operation,
    sessionId: trace.sessionId,
    artifactId: trace.artifactId,
    workspaceIdHash: trace.workspaceIdHash,
    consentVersion: trace.consentVersion,
  }
}

export type TraceableLlmRequest =
  | LlmInvokeRequest
  | LlmTestConnectionRequest
  | LlmListModelsRequest
