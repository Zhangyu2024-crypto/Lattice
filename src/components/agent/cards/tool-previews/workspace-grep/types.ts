// Phase 3a · workspace_grep preview — input/output shape narrowing.
//
// The orchestrator hands tool results to the registry as `unknown`, so we
// narrow them into concrete structs here before anything reaches the view
// layer. Kept pure so the view files stay render-only.

export interface GrepInput {
  pattern: string
  glob?: string
  caseInsensitive?: boolean
}

export interface GrepMatch {
  file: string
  line: number
  text: string
}

export interface GrepOutput {
  matches: GrepMatch[]
  truncated: boolean
}

export function narrowInput(value: unknown): GrepInput | null {
  if (!value || typeof value !== 'object') return null
  const v = value as { pattern?: unknown; glob?: unknown; caseInsensitive?: unknown }
  if (typeof v.pattern !== 'string' || v.pattern.length === 0) return null
  return {
    pattern: v.pattern,
    glob: typeof v.glob === 'string' ? v.glob : undefined,
    caseInsensitive: v.caseInsensitive === true,
  }
}

export function narrowOutput(value: unknown): GrepOutput | null {
  if (!value || typeof value !== 'object') return null
  const raw = (value as { matches?: unknown; truncated?: unknown }).matches
  if (!Array.isArray(raw)) return null
  const matches: GrepMatch[] = []
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue
    const row = m as { file?: unknown; line?: unknown; text?: unknown }
    if (typeof row.file !== 'string') continue
    if (typeof row.line !== 'number') continue
    if (typeof row.text !== 'string') continue
    matches.push({ file: row.file, line: row.line, text: row.text })
  }
  return {
    matches,
    truncated: (value as { truncated?: unknown }).truncated === true,
  }
}
