// Credentials read/write, modelled after lattice-cli's
// `sync/manager.py::_load_credentials` / `_save_credentials`.
//
// File layout: `${userData}/sync/credentials.json`, mode 0600. Environment
// variables (`LATTICE_SYNC_*`) override anything on disk, matching CLI
// behaviour so CI/CD and the app can share the same secrets.
//
// The password is ONLY read by the Electron main process. `sync:get-config`
// intentionally returns every field EXCEPT the password — the renderer
// never sees it in cleartext, avoiding accidental exposure through dev
// tools or error reports.

import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import type { BackendKind, SyncCredentials } from './types'

export function credentialsPath(): string {
  return path.join(app.getPath('userData'), 'sync', 'credentials.json')
}

function emptyCredentials(): SyncCredentials {
  return {
    version: 1,
    backend: '',
    remote_url: '',
    username: '',
    password: '',
  }
}

function normalizeBackend(raw: unknown): BackendKind | '' {
  if (raw === 'webdav' || raw === 'rclone') return raw
  return ''
}

async function readFromDisk(): Promise<SyncCredentials> {
  try {
    const raw = await fs.readFile(credentialsPath(), 'utf8')
    const data = JSON.parse(raw) as Partial<SyncCredentials>
    return {
      version: 1,
      backend: normalizeBackend(data.backend),
      remote_url: typeof data.remote_url === 'string' ? data.remote_url : '',
      username: typeof data.username === 'string' ? data.username : '',
      password: typeof data.password === 'string' ? data.password : '',
    }
  } catch {
    return emptyCredentials()
  }
}

function applyEnvOverrides(creds: SyncCredentials): SyncCredentials {
  const out = { ...creds }
  const env = process.env
  if (env.LATTICE_SYNC_BACKEND) {
    const b = normalizeBackend(env.LATTICE_SYNC_BACKEND)
    if (b) out.backend = b
  }
  if (env.LATTICE_SYNC_REMOTE_URL) out.remote_url = env.LATTICE_SYNC_REMOTE_URL
  if (env.LATTICE_SYNC_USERNAME) out.username = env.LATTICE_SYNC_USERNAME
  if (env.LATTICE_SYNC_PASSWORD) out.password = env.LATTICE_SYNC_PASSWORD
  // Bearer token short-circuit: CLI treats TOKEN as an alternative to
  // username+password, but the webdav client only accepts the two-tuple.
  // Store the token in `password` with a sentinel username so the backend
  // can send it as an HTTP Bearer header. Kept simple for V1.
  if (env.LATTICE_SYNC_TOKEN) {
    out.username = 'bearer'
    out.password = env.LATTICE_SYNC_TOKEN
  }
  return out
}

/** Reads credentials from disk and applies env-var overrides. */
export async function loadCredentials(): Promise<SyncCredentials> {
  return applyEnvOverrides(await readFromDisk())
}

/** Persists credentials to disk with mode 0600. Creates the parent dir. */
export async function saveCredentials(creds: SyncCredentials): Promise<void> {
  const target = credentialsPath()
  await fs.mkdir(path.dirname(target), { recursive: true })
  const tmp = `${target}.tmp`
  await fs.writeFile(tmp, JSON.stringify(creds, null, 2), 'utf8')
  // chmod must happen before rename on POSIX so the final file is never
  // world-readable even for a millisecond. Windows ignores mode bits — the
  // file still ends up inside `%APPDATA%/<app>` which is per-user, acceptable.
  try {
    await fs.chmod(tmp, 0o600)
  } catch {
    // chmod may not be supported (e.g. FAT32); best-effort.
  }
  await fs.rename(tmp, target)
}

/** Renderer-safe projection: every field except `password`. */
export function redactCredentials(creds: SyncCredentials): Omit<SyncCredentials, 'password'> {
  const { password: _password, ...rest } = creds
  return rest
}
