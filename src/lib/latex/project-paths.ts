import type { LatexFile, LatexFileKind } from '../../types/latex'

export const LATEX_CREATOR_WORKSPACE_DIR = 'creator'

export function normalizeLatexProjectPath(raw: string): string {
  const trimmed = raw.trim().replace(/\\/g, '/').replace(/^["'`]|["'`]$/g, '')
  if (
    !trimmed ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('~') ||
    /^[a-zA-Z]:($|\/)/.test(trimmed) ||
    /[\0-\x1f\x7f]/.test(trimmed)
  ) {
    return ''
  }
  const parts: string[] = []
  for (const part of trimmed.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return ''
      parts.pop()
      continue
    }
    if (part.includes(':')) return ''
    parts.push(part)
  }
  return parts.join('/')
}

export function creatorWorkspacePath(projectPath: string): string {
  const normalized = normalizeLatexProjectPath(projectPath)
  return normalized ? `${LATEX_CREATOR_WORKSPACE_DIR}/${normalized}` : ''
}

export function normalizeLatexProjectFiles(files: LatexFile[]): LatexFile[] {
  const out: LatexFile[] = []
  const seen = new Set<string>()
  for (const file of files) {
    const path = normalizeLatexProjectPath(file.path)
    if (!path || seen.has(path)) continue
    seen.add(path)
    out.push({ ...file, path, kind: file.kind ?? kindFromLatexPath(path) })
  }
  return out
}

export function kindFromLatexPath(path: string): LatexFileKind {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'tex') return 'tex'
  if (ext === 'bib') return 'bib'
  return 'asset'
}

export function ensureLatexExtension(path: string): string {
  if (!path) return ''
  if (/\.[^/.]+$/.test(path)) return path
  return `${path}.tex`
}

export function resolveLatexInputPath(fromFile: string, input: string): string {
  const rawInput = input
    .trim()
    .replace(/\\/g, '/')
    .replace(/^["'`]|["'`]$/g, '')
    .replace(/\.(tex|bib)$/i, '')
  const cleaned = ensureLatexExtension(rawInput)
  if (!cleaned) return ''
  const baseDir = normalizeLatexProjectPath(fromFile).split('/').slice(0, -1)
  if (cleaned.startsWith('./') || cleaned.startsWith('../')) {
    return normalizeLatexProjectPath([...baseDir, cleaned].join('/'))
  }
  const normalized = normalizeLatexProjectPath(cleaned)
  if (!normalized) return ''
  if (cleaned.includes('/')) return normalized
  return normalizeLatexProjectPath([...baseDir, normalized].join('/'))
}
