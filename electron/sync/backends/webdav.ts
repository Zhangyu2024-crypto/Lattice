// WebDAV backend — thin wrapper over the `webdav` npm package.
// Targets Nutstore first but works for any RFC 4918 server that
// supports PUT/GET/PROPFIND/MKCOL/DELETE (NextCloud, ownCloud, Box,
// Apache mod_dav).
//
// Notes on Nutstore quirks the wrapper handles:
//   - URL must end with `/`. We normalize on construction.
//   - Path segments with `+` must be percent-encoded; the `webdav` package
//     does this correctly via encodeURI, so we just avoid mangling the path
//     before handing it over.
//   - PROPFIND with Depth: infinity is refused on Nutstore free tier; we
//     pass Depth: 1 repeatedly per-directory instead, which `webdav`
//     exposes via `getDirectoryContents(path, { deep: true })` internally.

import { createReadStream, createWriteStream, promises as fs } from 'fs'
import path from 'path'
import type { AuthType, FileStat, WebDAVClient } from 'webdav'
import { createClient } from 'webdav'
import type { CloudBackend, RemoteFileInfo } from '../types'
import { BackendError } from './base'

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return trimmed
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`
}

function stripLeadingSlash(p: string): string {
  return p.startsWith('/') ? p.slice(1) : p
}

function mapError(err: unknown): BackendError {
  if (err instanceof BackendError) return err
  const e = err as { status?: number; response?: { status?: number }; message?: string }
  const status = e?.status ?? e?.response?.status
  const msg = e?.message ?? String(err)
  if (status === 401 || status === 403) {
    return new BackendError(`auth rejected: ${msg}`, status === 401 ? 'auth' : 'forbidden', status)
  }
  if (status === 404) return new BackendError(msg, 'not_found', status)
  if (status === 507) return new BackendError(msg, 'quota', status)
  if (!status) return new BackendError(msg, 'network')
  return new BackendError(msg, 'protocol', status)
}

export class WebDAVBackend implements CloudBackend {
  private readonly client: WebDAVClient

  constructor(
    private readonly baseUrl: string,
    username: string,
    password: string,
  ) {
    const normalized = normalizeBaseUrl(baseUrl)
    // The `webdav` package picks auth type by presence of `username`/`token`:
    // we use Basic unless the sentinel "bearer" username is passed, which
    // the credentials layer sets when LATTICE_SYNC_TOKEN is defined.
    const isBearer = username === 'bearer'
    const authType: AuthType | undefined = isBearer
      ? ('None' as AuthType)
      : undefined
    this.client = createClient(normalized, {
      username: isBearer ? undefined : username,
      password: isBearer ? undefined : password,
      token: isBearer ? { access_token: password, token_type: 'Bearer' } : undefined,
      authType,
    })
  }

  name(): 'webdav' {
    return 'webdav'
  }

  async testConnection(): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      // Listing the root is the cheapest reachability check. Nutstore
      // returns 207 Multi-Status on success; any non-2xx bubbles up as a
      // thrown error from the `webdav` client.
      await this.client.getDirectoryContents('/', { deep: false })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: mapError(err).message }
    }
  }

  async ensureRemoteDir(remoteDir: string): Promise<void> {
    // MKCOL is idempotent via try/catch — many WebDAV servers return 405
    // when the collection already exists.
    const parts = stripLeadingSlash(remoteDir).split('/').filter(Boolean)
    let cur = ''
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part
      try {
        await this.client.createDirectory(`/${cur}`)
      } catch (err) {
        const status = (err as { status?: number }).status
        if (status === 405 || status === 409 || status === 301) continue
        // 301 happens on some servers when the collection already exists
        // and they redirect to the trailing-slash URL.
        if (await this.client.exists(`/${cur}`)) continue
        throw mapError(err)
      }
    }
  }

  async upload(localPath: string, remotePath: string): Promise<void> {
    const remote = `/${stripLeadingSlash(remotePath)}`
    const parentDir = path.posix.dirname(remote)
    if (parentDir && parentDir !== '/') {
      await this.ensureRemoteDir(parentDir)
    }
    try {
      const stat = await fs.stat(localPath)
      // `webdav` supports piping a readable stream straight to PUT, which
      // avoids buffering the whole file in memory — important for PDFs.
      const writeStream = this.client.createWriteStream(remote, {
        headers: { 'Content-Length': String(stat.size) },
      })
      await new Promise<void>((resolve, reject) => {
        const readStream = createReadStream(localPath)
        readStream.on('error', reject)
        writeStream.on('error', reject)
        writeStream.on('finish', () => resolve())
        readStream.pipe(writeStream)
      })
    } catch (err) {
      throw mapError(err)
    }
  }

  async download(remotePath: string, localPath: string): Promise<void> {
    const remote = `/${stripLeadingSlash(remotePath)}`
    await fs.mkdir(path.dirname(localPath), { recursive: true })
    try {
      await new Promise<void>((resolve, reject) => {
        const readStream = this.client.createReadStream(remote)
        const writeStream = createWriteStream(localPath)
        readStream.on('error', reject)
        writeStream.on('error', reject)
        writeStream.on('finish', () => resolve())
        readStream.pipe(writeStream)
      })
    } catch (err) {
      throw mapError(err)
    }
  }

  async listFiles(prefix = ''): Promise<RemoteFileInfo[]> {
    const dir = `/${stripLeadingSlash(prefix)}`
    try {
      // `details: false` makes the webdav lib return FileStat[] directly
      // (not the ResponseDataDetailed wrapper), but its static overload
      // union still widens to `never` without a cast.
      const list = (await this.client.getDirectoryContents(dir, {
        deep: true,
        details: false,
      })) as FileStat[]
      return list
        .filter((e: FileStat) => e.type === 'file')
        .map((e: FileStat) => ({
          path: stripLeadingSlash(
            // `filename` from the webdav lib is the full server path
            // (e.g. `/dav/lattice/library/library.json`). Strip our base
            // directory prefix so manifest keys are backend-root-relative.
            e.filename.startsWith(dir) ? e.filename.slice(dir.length) : e.filename,
          ),
          size: typeof e.size === 'number' ? e.size : 0,
          mtime: typeof e.lastmod === 'string' ? new Date(e.lastmod).toISOString() : '',
        }))
    } catch (err) {
      const mapped = mapError(err)
      if (mapped.kind === 'not_found') return []
      throw mapped
    }
  }

  async delete(remotePath: string): Promise<void> {
    const remote = `/${stripLeadingSlash(remotePath)}`
    try {
      await this.client.deleteFile(remote)
    } catch (err) {
      const mapped = mapError(err)
      if (mapped.kind === 'not_found') return
      throw mapped
    }
  }

  async exists(remotePath: string): Promise<boolean> {
    const remote = `/${stripLeadingSlash(remotePath)}`
    try {
      return await this.client.exists(remote)
    } catch {
      return false
    }
  }
}
