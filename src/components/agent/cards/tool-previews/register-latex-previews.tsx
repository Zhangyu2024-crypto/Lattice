// Side-effect module: wires the latex_* agent-tool preview resolvers
// into the shared preview registry. Imported from AgentCard alongside the
// other register-* files so the side-effect fires exactly once at
// AgentCard bundle load.

import { registerToolPreview } from '../preview-registry'

// ─── latex_edit_selection ─────────────────────────────────────────────

interface LatexEditSelectionOut {
  verb?: string
  file?: string
  from?: number
  to?: number
  before?: string
  after?: string
  summary?: string
}

registerToolPreview('latex_edit_selection', (step) => {
  const out = (step.output ?? {}) as LatexEditSelectionOut
  const verb = out.verb ?? 'edit'
  const file = out.file ?? ''
  const span =
    typeof out.from === 'number' && typeof out.to === 'number'
      ? `${out.from}-${out.to}`
      : ''
  const oneLiner = span ? `${verb} · ${file}:${span}` : out.summary ?? verb
  const excerpt = out.before
    ? out.before.replace(/\s+/g, ' ').slice(0, 60) + (out.before.length > 60 ? '…' : '')
    : undefined
  return {
    oneLiner,
    compact: excerpt,
  }
})

// ─── latex_fix_compile_error ──────────────────────────────────────────

interface LatexFixCompileErrorOut {
  success?: boolean
  file?: string
  fromLine?: number
  toLine?: number
  errorMessage?: string
  summary?: string
}

registerToolPreview('latex_fix_compile_error', (step) => {
  const out = (step.output ?? {}) as LatexFixCompileErrorOut
  if (out.success === false) {
    return { oneLiner: out.summary ?? 'Could not propose a fix' }
  }
  const span =
    typeof out.fromLine === 'number' && typeof out.toLine === 'number'
      ? `:${out.fromLine}-${out.toLine}`
      : ''
  const file = out.file ?? '?'
  const msg = (out.errorMessage ?? '').slice(0, 60)
  return {
    oneLiner: `${file}${span}${msg ? ' · ' + msg : ''}`,
  }
})

// ─── latex_insert_figure_from_artifact ────────────────────────────────

interface LatexFigureOut {
  success?: boolean
  insertFile?: string
  insertAt?: number
  sourceKind?: string
  summary?: string
}

registerToolPreview('latex_insert_figure_from_artifact', (step) => {
  const out = (step.output ?? {}) as LatexFigureOut
  if (out.success === false) {
    return { oneLiner: out.summary ?? 'Could not draft a figure' }
  }
  const parts: string[] = []
  if (out.sourceKind) parts.push(out.sourceKind)
  if (out.insertFile) {
    const at = typeof out.insertAt === 'number' ? `@${out.insertAt}` : ''
    parts.push(`→ ${out.insertFile}${at}`)
  }
  return {
    oneLiner: parts.length > 0 ? parts.join(' ') : out.summary ?? 'figure',
  }
})

// ─── latex_add_citation ───────────────────────────────────────────────

interface LatexCitationOut {
  success?: boolean
  citationsAdded?: number
  operations?: Array<{ file?: string }>
  summary?: string
}

registerToolPreview('latex_add_citation', (step) => {
  const out = (step.output ?? {}) as LatexCitationOut
  if (out.success === false) {
    return { oneLiner: out.summary ?? 'No citations proposed' }
  }
  const n = out.citationsAdded ?? 0
  const fileCount = new Set(
    (out.operations ?? []).map((o) => o?.file).filter(Boolean) as string[],
  ).size
  return {
    oneLiner:
      n === 0
        ? 'No citations proposed'
        : `${n} cite${n === 1 ? '' : 's'} across ${fileCount} file${fileCount === 1 ? '' : 's'}`,
  }
})
