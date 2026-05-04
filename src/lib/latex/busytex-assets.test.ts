import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BUSYTEX_DATA_PACKAGE_FILES,
  BUSYTEX_PRELOAD_PACKAGE_FILES,
  BUSYTEX_REQUIRED_RUNTIME_FILES,
  busytexAssetUrl,
  busytexDataFileForPackage,
} from './busytex-assets'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
)
const publicBusytexDir = path.join(repoRoot, 'public/busytex')
const setupScript = readFileSync(
  path.join(repoRoot, 'scripts/download-data.sh'),
  'utf8',
)

describe('BusyTeX assets', () => {
  it('keeps preloaded packages in the full package list', () => {
    const allPackageFiles = new Set(BUSYTEX_DATA_PACKAGE_FILES)
    expect(
      BUSYTEX_PRELOAD_PACKAGE_FILES.filter((file) => !allPackageFiles.has(file)),
    ).toEqual([])
  })

  it('declares a data file peer for every package script', () => {
    for (const packageFile of BUSYTEX_DATA_PACKAGE_FILES) {
      expect(BUSYTEX_REQUIRED_RUNTIME_FILES).toContain(packageFile)
      expect(BUSYTEX_REQUIRED_RUNTIME_FILES).toContain(
        busytexDataFileForPackage(packageFile),
      )
    }
  })

  it('only references tracked runtime scripts that exist under public/busytex', () => {
    const trackedFiles = BUSYTEX_REQUIRED_RUNTIME_FILES.filter(
      (file) => !file.endsWith('.data') && !file.endsWith('.wasm'),
    )
    const missing = trackedFiles.filter(
      (file) => !existsSync(path.join(publicBusytexDir, file)),
    )
    expect(missing).toEqual([])
  })

  it('downloads every ignored large runtime asset from setup', () => {
    const ignoredLargeAssets = BUSYTEX_REQUIRED_RUNTIME_FILES.filter(
      (file) => file.endsWith('.data') || file.endsWith('.wasm'),
    )
    expect(ignoredLargeAssets).toEqual([
      'busytex.wasm',
      'texlive-basic.data',
      'ubuntu-texlive-latex-base.data',
      'ubuntu-texlive-fonts-recommended.data',
      'ubuntu-texlive-latex-recommended.data',
      'ubuntu-texlive-latex-extra.data',
      'ubuntu-texlive-science.data',
    ])
    for (const asset of ignoredLargeAssets) {
      expect(setupScript).toContain(`download_busytex "${asset}"`)
    }
  })

  it('builds absolute URLs from the renderer origin', () => {
    expect(busytexAssetUrl('busytex.js', 'http://localhost:5173')).toBe(
      'http://localhost:5173/busytex/busytex.js',
    )
  })
})
