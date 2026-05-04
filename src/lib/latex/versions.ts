import type {
  LatexDocumentPayload,
  LatexDocumentVersion,
  LatexFile,
  LatexVersionReason,
} from '../../types/latex'
import { genShortId } from '../id-gen'
import { normalizeLatexProjectFiles, normalizeLatexProjectPath } from './project-paths'

const MAX_LATEX_VERSIONS = 30

interface CreateLatexVersionArgs {
  files: LatexFile[]
  rootFile: string
  activeFile: string
  label: string
  reason: LatexVersionReason
  now?: number
}

export function createLatexVersion({
  files,
  rootFile,
  activeFile,
  label,
  reason,
  now = Date.now(),
}: CreateLatexVersionArgs): LatexDocumentVersion {
  const normalized = normalizeLatexProjectFiles(files)
  const root = normalizeLatexProjectPath(rootFile) || normalized[0]?.path || 'main.tex'
  const active = normalizeLatexProjectPath(activeFile) || root
  return {
    id: genShortId('latexv', 8),
    label: label.trim() || defaultLatexVersionLabel(reason),
    reason,
    createdAt: now,
    files: normalized.map((f) => ({ ...f })),
    rootFile: normalized.some((f) => f.path === root) ? root : normalized[0]?.path ?? root,
    activeFile: normalized.some((f) => f.path === active)
      ? active
      : normalized[0]?.path ?? active,
  }
}

export function appendLatexVersion(
  existing: readonly LatexDocumentVersion[] | undefined,
  version: LatexDocumentVersion,
): LatexDocumentVersion[] {
  const versions = [version, ...(existing ?? [])]
  const seen = new Set<string>()
  const deduped: LatexDocumentVersion[] = []
  for (const v of versions) {
    if (seen.has(v.id)) continue
    seen.add(v.id)
    deduped.push(v)
    if (deduped.length >= MAX_LATEX_VERSIONS) break
  }
  return deduped
}

export function defaultLatexVersionLabel(reason: LatexVersionReason): string {
  switch (reason) {
    case 'compile-success':
      return 'Compile succeeded'
    case 'ai-apply':
      return 'Before AI apply'
    case 'restore':
      return 'Before restore'
    case 'manual':
    default:
      return 'Manual checkpoint'
  }
}

export function restoreLatexVersionPayload(
  payload: LatexDocumentPayload,
  version: LatexDocumentVersion,
): LatexDocumentPayload {
  const files = normalizeLatexProjectFiles(version.files)
  const rootFile = files.some((f) => f.path === version.rootFile)
    ? version.rootFile
    : files[0]?.path ?? payload.rootFile
  const activeFile = files.some((f) => f.path === version.activeFile)
    ? version.activeFile
    : rootFile
  return {
    ...payload,
    files,
    rootFile,
    activeFile,
  }
}

export function formatLatexVersionReason(reason: LatexVersionReason): string {
  switch (reason) {
    case 'compile-success':
      return 'Compile'
    case 'ai-apply':
      return 'AI'
    case 'restore':
      return 'Restore'
    case 'manual':
    default:
      return 'Manual'
  }
}
