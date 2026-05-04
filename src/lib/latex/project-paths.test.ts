import { describe, expect, it } from 'vitest'
import {
  creatorWorkspacePath,
  ensureLatexExtension,
  normalizeLatexProjectFiles,
  normalizeLatexProjectPath,
  resolveLatexInputPath,
} from './project-paths'

describe('Creator project paths', () => {
  it('normalizes to POSIX relative paths', () => {
    expect(normalizeLatexProjectPath('.\\chapters\\..\\main.tex')).toBe(
      'main.tex',
    )
    expect(normalizeLatexProjectPath('./chapters//intro.tex')).toBe(
      'chapters/intro.tex',
    )
  })

  it('rejects OS paths and paths escaping the virtual project', () => {
    expect(normalizeLatexProjectPath('/tmp/main.tex')).toBe('')
    expect(normalizeLatexProjectPath('C:\\Users\\me\\main.tex')).toBe('')
    expect(normalizeLatexProjectPath('../../main.tex')).toBe('')
    expect(normalizeLatexProjectPath('chapters/../../main.tex')).toBe('')
  })

  it('deduplicates normalized file paths', () => {
    const files = normalizeLatexProjectFiles([
      { path: './main.tex', kind: 'tex', content: 'a' },
      { path: 'main.tex', kind: 'tex', content: 'b' },
      { path: 'refs.bib', kind: 'bib', content: '' },
    ])
    expect(files.map((f) => f.path)).toEqual(['main.tex', 'refs.bib'])
    expect(files[0].content).toBe('a')
  })

  it('keeps extension handling explicit for project files and inputs', () => {
    expect(ensureLatexExtension('chapters/methods')).toBe(
      'chapters/methods.tex',
    )
    expect(resolveLatexInputPath('chapters/intro.tex', 'methods')).toBe(
      'chapters/methods.tex',
    )
    expect(resolveLatexInputPath('chapters/intro.tex', '../main')).toBe(
      'main.tex',
    )
    expect(resolveLatexInputPath('main.tex', 'chapters/intro')).toBe(
      'chapters/intro.tex',
    )
    expect(resolveLatexInputPath('main.tex', '/tmp/escape')).toBe('')
  })

  it('maps project files into the workspace creator directory', () => {
    expect(creatorWorkspacePath('main.tex')).toBe('creator/main.tex')
    expect(creatorWorkspacePath('chapters/intro.tex')).toBe(
      'creator/chapters/intro.tex',
    )
    expect(creatorWorkspacePath('/tmp/main.tex')).toBe('')
  })
})
