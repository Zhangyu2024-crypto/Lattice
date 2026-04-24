// Pure helpers for `latex_insert_figure_from_artifact`: LaTeX escaping,
// caption fencing, array sampling, per-kind snippet builders, insertion
// anchor resolution, and caption-payload summarisation. All functions
// here are side-effect-free so they can be unit tested in isolation
// (no LLM calls, no runtime-store touches).

import type { Artifact } from '../../../types/artifact'
import type { LatexDocumentPayload } from '../../../types/latex'
import type { Placement } from './types'

export const CAPTION_SYSTEM =
  'Write a one-sentence academic caption describing this artifact\'s key ' +
  'finding. No quotes, no trailing period unless grammatical.'

export const SNIPPET_SAMPLES_MAX = 8

export function escapeLatex(input: string): string {
  return input
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
}

export function fenceCaption(text: string): string {
  // Single-line, escape LaTeX specials, trim excessive whitespace.
  const flat = text.replace(/\s+/g, ' ').trim()
  return escapeLatex(flat)
}

export function sampleXY(
  x: ReadonlyArray<number>,
  y: ReadonlyArray<number>,
  count: number,
): Array<[number, number]> {
  const n = Math.min(x.length, y.length)
  if (n === 0) return []
  const step = Math.max(1, Math.floor(n / count))
  const rows: Array<[number, number]> = []
  for (let i = 0; i < n; i += step) {
    rows.push([x[i], y[i]])
    if (rows.length >= count) break
  }
  return rows
}

export function xrdPhasesSnippet(
  artifact: Artifact,
  caption: string,
): string | null {
  const payload = artifact.payload as {
    phases?: Array<{
      name?: string
      formula?: string
      spaceGroup?: string
      confidence?: number
      weightFraction?: number | null
    }>
  }
  const phases = payload.phases ?? []
  if (phases.length === 0) return null
  const rows = phases
    .slice(0, 10)
    .map((p) => {
      const name = escapeLatex(p.name ?? p.formula ?? '—')
      const sg = escapeLatex(p.spaceGroup ?? '—')
      const conf =
        typeof p.confidence === 'number'
          ? `${(p.confidence * 100).toFixed(1)}\\%`
          : '—'
      const wt =
        typeof p.weightFraction === 'number'
          ? `${(p.weightFraction * 100).toFixed(1)}\\%`
          : '—'
      return `    ${name} & ${sg} & ${conf} & ${wt} \\\\`
    })
    .join('\n')
  return [
    '\\begin{table}[h]',
    '  \\centering',
    '  \\begin{tabular}{lccc}',
    '    \\hline',
    '    Phase & Space Group & Confidence & Weight \\\\',
    '    \\hline',
    rows,
    '    \\hline',
    '  \\end{tabular}',
    `  \\caption{${caption}}`,
    '\\end{table}',
  ].join('\n')
}

export function spectrumSnippet(
  artifact: Artifact,
  caption: string,
): string | null {
  // Probe a few known shapes for x/y arrays without forcing each Pro payload
  // to share a common type — the workbench payload shapes diverge slightly.
  const payload = artifact.payload as {
    spectrum?: { x?: number[]; y?: number[] }
    experimentalPattern?: { x?: number[]; y?: number[] }
    x?: number[]
    y?: number[]
  }
  const x =
    payload.spectrum?.x ??
    payload.experimentalPattern?.x ??
    payload.x ??
    []
  const y =
    payload.spectrum?.y ??
    payload.experimentalPattern?.y ??
    payload.y ??
    []
  const samples = sampleXY(x, y, SNIPPET_SAMPLES_MAX)
  if (samples.length === 0) return null
  const rows = samples
    .map(
      ([xi, yi]) =>
        `    ${xi.toFixed(3)} & ${yi.toFixed(4)} \\\\`,
    )
    .join('\n')
  return [
    '% MVP: tabular-only snippet until artifact PNG export lands (Phase D).',
    '\\begin{table}[h]',
    '  \\centering',
    '  \\begin{tabular}{cc}',
    '    \\hline',
    '    $x$ & $y$ \\\\',
    '    \\hline',
    rows,
    '    \\hline',
    '  \\end{tabular}',
    `  \\caption{${caption}}`,
    '\\end{table}',
  ].join('\n')
}

export function structureSnippet(
  artifact: Artifact,
  caption: string,
): string | null {
  const payload = artifact.payload as {
    formula?: string
    spaceGroup?: string
    latticeParams?: {
      a: number
      b: number
      c: number
      alpha: number
      beta: number
      gamma: number
    }
  }
  const formula = escapeLatex(payload.formula ?? '—')
  const sg = escapeLatex(payload.spaceGroup ?? '—')
  const lp = payload.latticeParams
  const abc = lp
    ? `${lp.a.toFixed(3)}, ${lp.b.toFixed(3)}, ${lp.c.toFixed(3)}`
    : '—'
  const angles = lp
    ? `${lp.alpha.toFixed(2)}, ${lp.beta.toFixed(2)}, ${lp.gamma.toFixed(2)}`
    : '—'
  return [
    '\\begin{table}[h]',
    '  \\centering',
    '  \\begin{tabular}{ll}',
    '    \\hline',
    `    Formula & ${formula} \\\\`,
    `    Space group & ${sg} \\\\`,
    `    $a, b, c$ (\\AA) & ${abc} \\\\`,
    `    $\\alpha, \\beta, \\gamma$ ($^\\circ$) & ${angles} \\\\`,
    '    \\hline',
    '  \\end{tabular}',
    `  \\caption{${caption}}`,
    '\\end{table}',
  ].join('\n')
}

export function stubSnippet(artifact: Artifact, caption: string): string {
  const title = escapeLatex(artifact.title)
  return [
    `% Stub reference — artifact kind '${artifact.kind}' has no tabular template yet.`,
    `\\textit{[details from ${title}]}`,
    `% caption: ${caption}`,
  ].join('\n')
}

export function buildSnippet(artifact: Artifact, caption: string): string {
  const fenced = fenceCaption(caption)
  switch (artifact.kind) {
    case 'xrd-analysis':
    case 'xrd-pro':
      return xrdPhasesSnippet(artifact, fenced) ?? stubSnippet(artifact, fenced)
    case 'spectrum':
    case 'spectrum-pro':
    case 'xps-pro':
    case 'raman-pro':
    case 'curve-pro':
      return spectrumSnippet(artifact, fenced) ?? stubSnippet(artifact, fenced)
    case 'structure':
      return structureSnippet(artifact, fenced) ?? stubSnippet(artifact, fenced)
    default:
      return stubSnippet(artifact, fenced)
  }
}

export function summarizeForCaption(artifact: Artifact): unknown {
  const p = artifact.payload as Record<string, unknown>
  const keys = Object.keys(p).slice(0, 6)
  const sketch: Record<string, unknown> = {}
  for (const k of keys) {
    const v = p[k]
    if (Array.isArray(v)) {
      sketch[k] = `Array(${v.length})`
    } else if (v && typeof v === 'object') {
      sketch[k] = Object.keys(v as object).slice(0, 6)
    } else {
      sketch[k] = v
    }
  }
  return sketch
}

export function resolveInsertPoint(
  payload: LatexDocumentPayload,
  placement: Placement,
): { file: string; offset: number } {
  const rootFile =
    payload.files.find((f) => f.path === payload.rootFile) ?? payload.files[0]
  const activeFile =
    payload.files.find((f) => f.path === payload.activeFile) ?? rootFile
  if (!rootFile) {
    return { file: 'main.tex', offset: 0 }
  }

  if (placement === 'end') {
    return { file: rootFile.path, offset: rootFile.content.length }
  }
  if (placement === 'cursor') {
    const state = payload.editorState?.[activeFile.path]
    const cursor = state?.cursor
    if (
      activeFile &&
      typeof cursor === 'number' &&
      cursor >= 0 &&
      cursor <= activeFile.content.length
    ) {
      return { file: activeFile.path, offset: cursor }
    }
    return {
      file: activeFile?.path ?? rootFile.path,
      offset: (activeFile ?? rootFile).content.length,
    }
  }
  // 'section' → insert just before the next \section in the root file, or
  // at EOF if no later heading exists. This is a best-effort anchor for
  // the MVP; a smarter placement belongs to Phase D.
  const text = rootFile.content
  const match = text.match(/\\section\s*\{[^}]*\}/)
  if (match && match.index != null) {
    return { file: rootFile.path, offset: match.index }
  }
  return { file: rootFile.path, offset: text.length }
}
