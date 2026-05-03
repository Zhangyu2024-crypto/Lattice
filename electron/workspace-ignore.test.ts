// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { isIgnoredWorkspacePath } from './workspace-ignore'

describe('isIgnoredWorkspacePath', () => {
  it('ignores generated and dependency directories anywhere in the tree', () => {
    expect(isIgnoredWorkspacePath('node_modules')).toBe(true)
    expect(isIgnoredWorkspacePath('packages/app/node_modules/react/index.js')).toBe(
      true,
    )
    expect(isIgnoredWorkspacePath('release/win-unpacked/Lattice.exe')).toBe(true)
    expect(isIgnoredWorkspacePath('dist-electron/main.mjs')).toBe(true)
    expect(isIgnoredWorkspacePath('src/__pycache__/module.pyc')).toBe(true)
  })

  it('ignores dotfiles and dot directories', () => {
    expect(isIgnoredWorkspacePath('.git')).toBe(true)
    expect(isIgnoredWorkspacePath('.cache/electron-builder')).toBe(true)
    expect(isIgnoredWorkspacePath('data/.hidden')).toBe(true)
  })

  it('ignores the bundled conda environment without hiding resources itself', () => {
    expect(isIgnoredWorkspacePath('resources')).toBe(false)
    expect(isIgnoredWorkspacePath('resources/conda-env')).toBe(true)
    expect(isIgnoredWorkspacePath('resources/conda-env/python.exe')).toBe(true)
  })

  it('keeps normal workspace files visible', () => {
    expect(isIgnoredWorkspacePath('data/sample.xy')).toBe(false)
    expect(isIgnoredWorkspacePath('paper/report.md')).toBe(false)
    expect(isIgnoredWorkspacePath('resources/icon.png')).toBe(false)
  })

  it('normalizes Windows separators', () => {
    expect(isIgnoredWorkspacePath('resources\\conda-env\\python.exe')).toBe(true)
    expect(isIgnoredWorkspacePath('src\\main.ts')).toBe(false)
  })
})
