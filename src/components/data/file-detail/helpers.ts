export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'tiff', 'tif', 'bmp', 'svg', 'webp'])

export function guessPreviewMode(relPath: string, dataType?: string): 'image' | 'pdf' | 'text' | 'none' {
  const ext = relPath.split('.').pop()?.toLowerCase() ?? ''
  if (IMAGE_EXTS.has(ext) || dataType === 'image') return 'image'
  if (ext === 'pdf' || dataType === 'paper') return 'pdf'
  if (['json', 'md', 'py', 'txt', 'csv', 'tsv', 'tex', 'bib', 'log', 'dat', 'cif', 'xy', 'jdx', 'dx'].includes(ext)) return 'text'
  if (relPath.endsWith('.spectrum.json') || relPath.endsWith('.xrd.json') || relPath.endsWith('.xps.json') ||
      relPath.endsWith('.raman.json') || relPath.endsWith('.peakfit.json') || relPath.endsWith('.chat.json') ||
      relPath.endsWith('.workbench.json') || relPath.endsWith('.job.json')) return 'text'
  return 'text'
}
