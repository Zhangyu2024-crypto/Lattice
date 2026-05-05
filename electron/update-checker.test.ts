// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  buildUpdateStatus,
  compareReleaseVersions,
  normalizeReleaseVersion,
  selectReleaseAsset,
} from './update-checker'

describe('update-checker', () => {
  it('normalizes release tag names', () => {
    expect(normalizeReleaseVersion('v1.2.3')).toBe('1.2.3')
    expect(normalizeReleaseVersion('lattice-v2.0.0')).toBe('2.0.0')
    expect(normalizeReleaseVersion('0.4.0-beta.1')).toBe('0.4.0-beta.1')
  })

  it('compares semantic release versions', () => {
    expect(compareReleaseVersions('0.1.0', '0.1.1')).toBe(-1)
    expect(compareReleaseVersions('v0.2.0', '0.1.9')).toBe(1)
    expect(compareReleaseVersions('1.0.0', 'v1.0.0')).toBe(0)
    expect(compareReleaseVersions('1.0.0-beta.1', '1.0.0')).toBe(-1)
  })

  it('selects a platform-appropriate release asset', () => {
    const assets = [
      { name: 'Lattice-linux.AppImage', browser_download_url: 'linux' },
      { name: 'Lattice-setup.exe', browser_download_url: 'win' },
      { name: 'Lattice.dmg', browser_download_url: 'mac' },
    ]

    expect(selectReleaseAsset(assets, 'win32')?.downloadUrl).toBe('win')
    expect(selectReleaseAsset(assets, 'darwin')?.downloadUrl).toBe('mac')
    expect(selectReleaseAsset(assets, 'linux')?.downloadUrl).toBe('linux')
  })

  it('builds latest and available statuses from GitHub payloads', () => {
    const checkedAt = '2026-05-05T12:00:00.000Z'
    const release = {
      tag_name: 'v0.2.0',
      name: 'Lattice 0.2.0',
      html_url: 'https://github.com/example/releases/tag/v0.2.0',
      published_at: checkedAt,
      assets: [{ name: 'Lattice.AppImage', browser_download_url: 'asset' }],
    }

    expect(
      buildUpdateStatus({
        currentVersion: '0.1.0',
        release,
        platform: 'linux',
        checkedAt,
      }),
    ).toMatchObject({
      state: 'available',
      latestVersion: '0.2.0',
      updateAvailable: true,
      downloadUrl: 'asset',
    })

    expect(
      buildUpdateStatus({
        currentVersion: '0.2.0',
        release,
        platform: 'linux',
        checkedAt,
      }),
    ).toMatchObject({
      state: 'latest',
      latestVersion: '0.2.0',
      updateAvailable: false,
    })
  })
})
