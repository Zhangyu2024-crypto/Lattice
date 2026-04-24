import type { LatexDocumentPayload, LatexMentionMode } from '../../types/latex'

// Shape consumed by llm-chat.ts's extractMentionData path for latex-document
// artifacts. Keeping it flat + JSON-stable lets the downstream
// `truncateForBudget` clip cleanly at MENTION_BUDGET.artifact (4096 chars).

interface LatexMentionContext {
  kind: 'latex-document'
  mode: LatexMentionMode
  rootFile: string
  fileCount: number
  outline: Array<{ file: string; level: number; title: string }>
  /** Present only when mode === 'full'. Concatenated with file headers so the
   *  model can tell where a section came from even after truncation. */
  source?: string
  /** Present when mode === 'selection' and the payload carries a selection
   *  hint (future Phase B will populate it; Phase A falls back to 'outline'). */
  selection?: { file: string; excerpt: string }
}

/**
 * Build a compact context block for a LaTeX mention. The caller
 * (`extractMentionData` in llm-chat.ts) truncates the resulting JSON at the
 * artifact budget; we just keep the fields ordered so the most useful
 * information (outline, rootFile) survives a clip.
 */
export function extractLatexMentionContext(
  payload: LatexDocumentPayload,
): LatexMentionContext {
  const outline = payload.outline.map((o) => ({
    file: o.file,
    level: o.level,
    title: o.title,
  }))
  const base: LatexMentionContext = {
    kind: 'latex-document',
    mode: payload.mentionMode,
    rootFile: payload.rootFile,
    fileCount: payload.files.length,
    outline,
  }
  if (payload.mentionMode === 'full') {
    base.source = payload.files
      .map((f) => `%%% FILE: ${f.path}\n${f.content}`)
      .join('\n\n')
    return base
  }
  // 'selection' + 'outline' share the same shape in Phase A (no live selection
  // wiring yet). We still distinguish `mode` so Phase B's selection-aware
  // invoker can narrow the context without re-shaping the callsite.
  return base
}
