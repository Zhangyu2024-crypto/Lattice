import { describe, expect, it } from 'vitest'
import {
  appendLatexVersion,
  createLatexVersion,
  restoreLatexVersionPayload,
} from './versions'
import type { LatexDocumentPayload, LatexDocumentVersion } from '../../types/latex'

function payload(): LatexDocumentPayload {
  return {
    files: [{ path: 'main.tex', kind: 'tex', content: 'current' }],
    rootFile: 'main.tex',
    activeFile: 'main.tex',
    engine: 'pdftex',
    status: 'idle',
    errors: [],
    warnings: [],
    logTail: '',
    mentionMode: 'selection',
    outline: [],
    ghostEnabled: false,
    autoCompile: true,
    autoFixSuggest: true,
  }
}

describe('latex versions', () => {
  it('captures full project files and metadata', () => {
    const version = createLatexVersion({
      files: [
        { path: 'main.tex', kind: 'tex', content: 'hello' },
        { path: 'refs.bib', kind: 'bib', content: '@article{x}' },
      ],
      rootFile: 'main.tex',
      activeFile: 'refs.bib',
      label: 'Draft',
      reason: 'manual',
      now: 123,
    })

    expect(version.label).toBe('Draft')
    expect(version.createdAt).toBe(123)
    expect(version.files).toHaveLength(2)
    expect(version.activeFile).toBe('refs.bib')
  })

  it('keeps only the newest 30 versions', () => {
    let versions: LatexDocumentVersion[] = []
    for (let i = 0; i < 35; i += 1) {
      versions = appendLatexVersion(
        versions,
        createLatexVersion({
          files: [{ path: 'main.tex', kind: 'tex', content: String(i) }],
          rootFile: 'main.tex',
          activeFile: 'main.tex',
          label: `v${i}`,
          reason: 'manual',
          now: i,
        }),
      )
    }
    expect(versions).toHaveLength(30)
    expect(versions[0].label).toBe('v34')
    expect(versions.at(-1)?.label).toBe('v5')
  })

  it('restores files without dropping existing version history', () => {
    const current = payload()
    const version = createLatexVersion({
      files: [{ path: 'main.tex', kind: 'tex', content: 'old' }],
      rootFile: 'main.tex',
      activeFile: 'main.tex',
      label: 'Old',
      reason: 'manual',
      now: 1,
    })
    const restored = restoreLatexVersionPayload(current, version)
    expect(restored.files[0].content).toBe('old')
    expect(restored.rootFile).toBe('main.tex')
  })
})
