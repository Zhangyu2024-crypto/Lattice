import type { LatexFile } from '../../types/latex'

export interface ParsedPackage {
  name: string
  options: string | null
  file: string
  line: number
  matchedLine: string
}

const PKG_RE =
  /^([^%]*)\\(?:usepackage|RequirePackage)\s*(\[[^\]]*\])?\s*\{([^}]+)\}/gm

export function parsePackages(source: string, filePath: string): ParsedPackage[] {
  const result: ParsedPackage[] = []
  const lines = source.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]
    PKG_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = PKG_RE.exec(ln)) !== null) {
      const opts = m[2] ? m[2].slice(1, -1) : null
      const names = m[3].split(',').map((s) => s.trim()).filter(Boolean)
      for (const name of names) {
        result.push({
          name: name.toLowerCase(),
          options: opts,
          file: filePath,
          line: i + 1,
          matchedLine: ln,
        })
      }
    }
  }
  return result
}

export function parseAllPackages(files: LatexFile[]): ParsedPackage[] {
  const out: ParsedPackage[] = []
  for (const f of files) {
    if (f.kind !== 'tex') continue
    out.push(...parsePackages(f.content, f.path))
  }
  return out
}
