export type AppUpdateState =
  | 'idle'
  | 'checking'
  | 'latest'
  | 'available'
  | 'error'

export interface GitHubReleaseAsset {
  name?: unknown
  browser_download_url?: unknown
}

export interface GitHubReleasePayload {
  tag_name?: unknown
  name?: unknown
  html_url?: unknown
  published_at?: unknown
  assets?: unknown
}

export interface AppUpdateStatusPayload {
  state: AppUpdateState
  currentVersion: string
  latestVersion?: string
  releaseName?: string
  releaseUrl?: string
  downloadUrl?: string
  assetName?: string
  publishedAt?: string
  checkedAt?: string
  updateAvailable: boolean
  error?: string
}

export function normalizeReleaseVersion(value: string): string {
  const trimmed = value.trim()
  const withoutPrefix = trimmed.replace(/^[^\d]*/, '')
  const match = withoutPrefix.match(
    /^(\d+(?:\.\d+){0,3})(?:[-+][0-9A-Za-z.-]+)?/,
  )
  return match?.[0] ?? trimmed
}

export function compareReleaseVersions(left: string, right: string): number {
  const a = normalizeReleaseVersion(left)
  const b = normalizeReleaseVersion(right)
  const [aMain, aPre = ''] = a.split('-', 2)
  const [bMain, bPre = ''] = b.split('-', 2)
  const aParts = aMain.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const bParts = bMain.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const length = Math.max(aParts.length, bParts.length, 3)
  for (let i = 0; i < length; i += 1) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  if (aPre === bPre) return 0
  if (!aPre) return 1
  if (!bPre) return -1
  return aPre.localeCompare(bPre)
}

export function buildUpdateStatus(params: {
  currentVersion: string
  release: GitHubReleasePayload
  platform: NodeJS.Platform
  checkedAt: string
}): AppUpdateStatusPayload {
  const tagName =
    typeof params.release.tag_name === 'string'
      ? params.release.tag_name.trim()
      : ''
  if (!tagName) {
    throw new Error('Latest GitHub release has no tag name.')
  }
  const latestVersion = normalizeReleaseVersion(tagName)
  const updateAvailable =
    compareReleaseVersions(params.currentVersion, latestVersion) < 0
  const asset = selectReleaseAsset(params.release.assets, params.platform)
  const releaseUrl =
    typeof params.release.html_url === 'string'
      ? params.release.html_url
      : undefined
  return {
    state: updateAvailable ? 'available' : 'latest',
    currentVersion: params.currentVersion,
    latestVersion,
    releaseName:
      typeof params.release.name === 'string' ? params.release.name : tagName,
    releaseUrl,
    downloadUrl: asset?.downloadUrl ?? releaseUrl,
    assetName: asset?.name,
    publishedAt:
      typeof params.release.published_at === 'string'
        ? params.release.published_at
        : undefined,
    checkedAt: params.checkedAt,
    updateAvailable,
  }
}

export function selectReleaseAsset(
  rawAssets: unknown,
  platform: NodeJS.Platform,
): { name: string; downloadUrl: string } | null {
  if (!Array.isArray(rawAssets)) return null
  const assets = rawAssets
    .map((raw): { name: string; downloadUrl: string } | null => {
      if (!raw || typeof raw !== 'object') return null
      const asset = raw as GitHubReleaseAsset
      if (
        typeof asset.name !== 'string' ||
        typeof asset.browser_download_url !== 'string'
      ) {
        return null
      }
      return { name: asset.name, downloadUrl: asset.browser_download_url }
    })
    .filter((asset): asset is { name: string; downloadUrl: string } =>
      Boolean(asset),
    )
  if (assets.length === 0) return null
  const priority =
    platform === 'win32'
      ? [/\.exe$/i, /\.msi$/i, /\.zip$/i]
      : platform === 'darwin'
        ? [/\.dmg$/i, /\.zip$/i]
        : [/\.AppImage$/i, /\.deb$/i, /\.rpm$/i, /\.tar\.gz$/i, /\.zip$/i]
  for (const pattern of priority) {
    const match = assets.find((asset) => pattern.test(asset.name))
    if (match) return match
  }
  return assets[0] ?? null
}
