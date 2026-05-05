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

export interface LatticeTraceContextPayload {
  traceId: string
  module: LatticeTraceModule
  operation: LatticeTraceOperation
  sessionId?: string | null
  artifactId?: string | null
  workspaceIdHash?: string | null
  consentVersion?: string | null
}

export function createLatticeTraceId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID()
  return `trace_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
}

export async function sha256Hex(input: string): Promise<string> {
  const cryptoApi = globalThis.crypto
  const bytes = new TextEncoder().encode(input)
  if (cryptoApi?.subtle) {
    const digest = await cryptoApi.subtle.digest('SHA-256', bytes)
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  }
  return fallbackHash(input)
}

function fallbackHash(input: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return `${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`
}
