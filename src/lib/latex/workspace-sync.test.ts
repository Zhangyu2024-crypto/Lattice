import { describe, expect, it } from 'vitest'
import { MemoryWorkspaceFs } from '../workspace/fs/MemoryWorkspaceFs'
import { syncLatexFilesToWorkspace } from './workspace-sync'

describe('Creator workspace sync', () => {
  it('writes normalized project files below creator/', async () => {
    const fs = new MemoryWorkspaceFs()
    await fs.setRoot('/tmp/lattice-test')

    const written = await syncLatexFilesToWorkspace(fs, [
      { path: './main.tex', kind: 'tex', content: 'main' },
      { path: 'chapters\\intro.tex', kind: 'tex', content: 'intro' },
      { path: '/tmp/escape.tex', kind: 'tex', content: 'escape' },
    ])

    expect(written).toBe(2)
    expect(await fs.readText('creator/main.tex')).toBe('main')
    expect(await fs.readText('creator/chapters/intro.tex')).toBe('intro')
    await expect(fs.readText('creator/tmp/escape.tex')).rejects.toThrow(
      /not a file/,
    )
  })
})
