const GENERATED_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  'dist-electron',
  'release',
  'venv',
  '__pycache__',
])

const GENERATED_REL_PREFIXES = ['resources/conda-env']

function normalizeRelPath(relPath: string): string {
  return relPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

function hasRelPrefix(relPath: string, prefix: string): boolean {
  return relPath === prefix || relPath.startsWith(`${prefix}/`)
}

export function isIgnoredWorkspacePath(relPath: string): boolean {
  const normalized = normalizeRelPath(relPath)
  if (!normalized) return false

  const parts = normalized.split('/').filter(Boolean)
  if (parts.some((part) => part.startsWith('.'))) return true
  if (parts.some((part) => GENERATED_DIR_NAMES.has(part))) return true

  return GENERATED_REL_PREFIXES.some((prefix) =>
    hasRelPrefix(normalized, prefix),
  )
}
