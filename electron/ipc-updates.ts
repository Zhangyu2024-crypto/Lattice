import { app, ipcMain, shell } from 'electron'
import {
  buildUpdateStatus,
  type AppUpdateStatusPayload,
  type GitHubReleasePayload,
} from './update-checker'

const DEFAULT_RELEASE_API_URL =
  'https://api.github.com/repos/Zhangyu2024-crypto/Lattice/releases/latest'
const DEFAULT_RELEASES_URL =
  'https://github.com/Zhangyu2024-crypto/Lattice/releases'
const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

let updateStatus: AppUpdateStatusPayload = {
  state: 'idle',
  currentVersion: app.getVersion(),
  updateAvailable: false,
}
let updateTimer: ReturnType<typeof setInterval> | null = null
let inFlightCheck: Promise<AppUpdateStatusPayload> | null = null

function releaseApiUrl(): string {
  return process.env.LATTICE_UPDATE_RELEASE_API_URL ?? DEFAULT_RELEASE_API_URL
}

function releasePageUrl(): string {
  return process.env.LATTICE_UPDATE_RELEASES_URL ?? DEFAULT_RELEASES_URL
}

function checkIntervalMs(): number {
  const raw = Number.parseInt(process.env.LATTICE_UPDATE_INTERVAL_MS ?? '', 10)
  if (!Number.isFinite(raw) || raw < 5 * 60_000) return DEFAULT_CHECK_INTERVAL_MS
  return raw
}

async function fetchLatestRelease(): Promise<GitHubReleasePayload> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(releaseApiUrl(), {
      signal: controller.signal,
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': `Lattice/${app.getVersion()}`,
        'x-github-api-version': '2022-11-28',
      },
    })
    if (!response.ok) {
      throw new Error(`GitHub returned HTTP ${response.status}`)
    }
    return (await response.json()) as GitHubReleasePayload
  } finally {
    clearTimeout(timer)
  }
}

export function getUpdateStatus(): AppUpdateStatusPayload {
  return updateStatus
}

export async function checkForAppUpdates(): Promise<AppUpdateStatusPayload> {
  if (inFlightCheck) return inFlightCheck
  updateStatus = {
    ...updateStatus,
    state: 'checking',
    error: undefined,
  }
  inFlightCheck = fetchLatestRelease()
    .then((release) =>
      buildUpdateStatus({
        currentVersion: app.getVersion(),
        release,
        platform: process.platform,
        checkedAt: new Date().toISOString(),
      }),
    )
    .then((status) => {
      updateStatus = status
      return status
    })
    .catch((err) => {
      const status: AppUpdateStatusPayload = {
        ...updateStatus,
        state: 'error',
        currentVersion: app.getVersion(),
        updateAvailable: false,
        checkedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      }
      updateStatus = status
      return status
    })
    .finally(() => {
      inFlightCheck = null
    })
  return inFlightCheck
}

export function startPeriodicUpdateChecks(): void {
  if (updateTimer) clearInterval(updateTimer)
  void checkForAppUpdates()
  updateTimer = setInterval(() => {
    void checkForAppUpdates()
  }, checkIntervalMs())
}

export function stopPeriodicUpdateChecks(): void {
  if (!updateTimer) return
  clearInterval(updateTimer)
  updateTimer = null
}

export function registerUpdateIpc(): void {
  ipcMain.handle('app-update:get-status', () => getUpdateStatus())
  ipcMain.handle('app-update:check', () => checkForAppUpdates())
  ipcMain.handle('app-update:open-release', async () => {
    const url =
      updateStatus.downloadUrl ?? updateStatus.releaseUrl ?? releasePageUrl()
    try {
      await shell.openExternal(url)
      return { ok: true, url }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  })
}
