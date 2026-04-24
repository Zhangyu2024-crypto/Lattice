// rclone backend — shell-out to a user-installed `rclone` binary.
// Covers the 50+ providers rclone supports (Google Drive, OneDrive,
// Dropbox, S3, …). App stores only the remote name (e.g. `gdrive:lattice`);
// OAuth tokens + endpoint config live in rclone's own `~/.config/rclone/rclone.conf`.
//
// The binary is not bundled — on construction we probe `rclone version`
// and surface a typed error if it's missing so the Settings UI can point
// the user at the install docs.

import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import type { CloudBackend, RemoteFileInfo } from '../types'
import { BackendError } from './base'

function splitRemote(ref: string): { remote: string; root: string } {
  // ref looks like `gdrive:lattice-backup` or `s3:bucket/prefix`.
  const colon = ref.indexOf(':')
  if (colon < 0) throw new BackendError(`invalid rclone remote: ${ref}`, 'protocol')
  return {
    remote: ref.slice(0, colon),
    root: ref.slice(colon + 1).replace(/^\/+|\/+$/g, ''),
  }
}

interface ProcResult {
  code: number
  stdout: string
  stderr: string
}

function run(cmd: string, args: string[], timeoutMs = 120_000): Promise<ProcResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args)
    let stdout = ''
    let stderr = ''
    const kill = setTimeout(() => {
      try {
        child.kill('SIGTERM')
      } catch {
        /* already gone */
      }
    }, timeoutMs)
    child.stdout.on('data', (c) => {
      stdout += c.toString('utf8')
    })
    child.stderr.on('data', (c) => {
      stderr += c.toString('utf8')
    })
    child.on('error', (err) => {
      clearTimeout(kill)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(kill)
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}

export interface RcloneLsjsonEntry {
  Path: string
  Name: string
  Size: number
  IsDir: boolean
  ModTime: string
}

/** Probes `rclone version`. Rejects with a typed `BackendError` when the
 *  binary isn't on PATH — the UI can catch this and prompt for install. */
export async function assertRcloneInstalled(): Promise<void> {
  try {
    const res = await run('rclone', ['version'], 5_000)
    if (res.code !== 0) {
      throw new BackendError(
        `rclone exited ${res.code}: ${res.stderr.trim().slice(0, 300)}`,
        'binary_missing',
      )
    }
  } catch (err) {
    if (err instanceof BackendError) throw err
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      throw new BackendError(
        'rclone binary not found on PATH (install from https://rclone.org/install/)',
        'binary_missing',
      )
    }
    throw new BackendError(`rclone probe failed: ${(err as Error).message}`, 'unknown')
  }
}

export class RcloneBackend implements CloudBackend {
  private readonly remote: string
  private readonly root: string

  constructor(remoteRef: string) {
    const parsed = splitRemote(remoteRef)
    this.remote = parsed.remote
    this.root = parsed.root
  }

  name(): 'rclone' {
    return 'rclone'
  }

  private addr(remotePath: string): string {
    const rel = remotePath.replace(/^\/+/, '')
    const joined = this.root ? `${this.root}/${rel}` : rel
    return `${this.remote}:${joined}`
  }

  async testConnection(): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await assertRcloneInstalled()
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
    const res = await run('rclone', ['lsf', '--max-depth', '1', `${this.remote}:${this.root}`])
    if (res.code !== 0) {
      return { ok: false, error: res.stderr.trim().slice(0, 500) || `rclone lsf exited ${res.code}` }
    }
    return { ok: true }
  }

  async upload(localPath: string, remotePath: string): Promise<void> {
    const res = await run('rclone', ['copyto', localPath, this.addr(remotePath)])
    if (res.code !== 0) {
      throw new BackendError(
        `rclone copyto failed: ${res.stderr.trim().slice(0, 500)}`,
        'unknown',
      )
    }
  }

  async download(remotePath: string, localPath: string): Promise<void> {
    await fs.mkdir(path.dirname(localPath), { recursive: true })
    const res = await run('rclone', ['copyto', this.addr(remotePath), localPath])
    if (res.code !== 0) {
      throw new BackendError(
        `rclone copyto (download) failed: ${res.stderr.trim().slice(0, 500)}`,
        'unknown',
      )
    }
  }

  async listFiles(prefix = ''): Promise<RemoteFileInfo[]> {
    const target = this.addr(prefix)
    const res = await run('rclone', ['lsjson', '--recursive', target])
    if (res.code !== 0) {
      // 404-ish: rclone returns non-zero when the directory doesn't exist.
      // An empty remote is a normal first-push scenario, so we swallow it.
      if (/directory not found|doesn't exist/i.test(res.stderr)) return []
      throw new BackendError(
        `rclone lsjson failed: ${res.stderr.trim().slice(0, 500)}`,
        'unknown',
      )
    }
    let parsed: RcloneLsjsonEntry[]
    try {
      parsed = JSON.parse(res.stdout || '[]') as RcloneLsjsonEntry[]
    } catch (err) {
      throw new BackendError(`rclone lsjson: invalid JSON: ${(err as Error).message}`, 'protocol')
    }
    return parsed
      .filter((e) => !e.IsDir)
      .map((e) => ({
        path: e.Path,
        size: e.Size,
        mtime: e.ModTime,
      }))
  }

  async delete(remotePath: string): Promise<void> {
    const res = await run('rclone', ['deletefile', this.addr(remotePath)])
    if (res.code !== 0 && !/not found|doesn't exist/i.test(res.stderr)) {
      throw new BackendError(
        `rclone deletefile failed: ${res.stderr.trim().slice(0, 500)}`,
        'unknown',
      )
    }
  }

  async exists(remotePath: string): Promise<boolean> {
    const res = await run('rclone', ['lsf', this.addr(remotePath)])
    return res.code === 0 && res.stdout.trim().length > 0
  }
}
