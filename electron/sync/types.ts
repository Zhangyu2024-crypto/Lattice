// Cloud-sync shared types — ported from lattice-cli's `sync/manifest.py` +
// `sync/backends/base.py`. Mirrors the on-disk schema documented in
// `lattice-cli/docs/cloud_sync.md §4.2` so a manifest written by the CLI is
// (forward-)compatible with this TS reimplementation and vice versa.

export type BackendKind = 'webdav' | 'rclone'

export type SyncPolicy = 'required' | 'optional' | 'exclude'

export interface FileState {
  /** `sha256:<hex>` — truncated to 16 hex chars to match CLI format. */
  local_hash: string
  remote_hash: string
  /** Bytes on disk. Kept in sync with `local_hash`; used as a cheap
   *  "did-the-remote-change" proxy when the backend can't cheaply return
   *  per-file hashes (WebDAV PROPFIND gives size + mtime, not content hash). */
  size: number
  policy: SyncPolicy
  local_mtime: string
  remote_mtime: string
}

export type SyncIntervalMinutes = 0 | 5 | 15 | 30 | 60

export interface SyncManifest {
  version: 1
  backend: BackendKind | ''
  remote_url: string
  /** Top-level folder on the remote side. Default `Lattice`. All synced
   *  files live under `<remote_url>/<remote_root>/{library,research,…}/`. */
  remote_root: string
  last_sync: string
  auto_push: boolean
  auto_pull: boolean
  sync_interval: SyncIntervalMinutes
  excluded_roots: string[]
  files: Record<string, FileState>
}

/** All sync roots under `${userData}`. The order here also drives the
 *  order they show up in the SyncTab folder list. */
export const SYNC_ROOTS = [
  'library',          // papers + PDFs
  'research',         // research reports
  'artifacts',        // Lattice-produced analysis results
  'compute-scripts',  // user-saved analysis scripts
  'raw',              // raw experimental data (.xy / .xrdml / .cif / …)
] as const
export type SyncRoot = typeof SYNC_ROOTS[number]

export interface FolderStats {
  root: string
  fileCount: number
  totalBytes: number
  toPush: number
  toPull: number
  conflicts: number
}

export interface SyncCredentials {
  version: 1
  backend: BackendKind | ''
  remote_url: string
  /** WebDAV user; empty for rclone. */
  username: string
  /** WebDAV password or bearer token; empty for rclone. */
  password: string
}

export interface RemoteFileInfo {
  /** Path relative to the backend root (no leading slash). */
  path: string
  size: number
  /** ISO-8601. Empty string when the backend doesn't expose mtime. */
  mtime: string
}

export interface CloudBackend {
  name(): BackendKind
  testConnection(): Promise<{ ok: true } | { ok: false; error: string }>
  upload(localPath: string, remotePath: string): Promise<void>
  download(remotePath: string, localPath: string): Promise<void>
  listFiles(prefix?: string): Promise<RemoteFileInfo[]>
  delete(remotePath: string): Promise<void>
  exists(remotePath: string): Promise<boolean>
}

export interface Conflict {
  path: string
  localSize: number
  localMtime: string
  remoteSize: number
  remoteMtime: string
}

export interface SkippedEntry {
  path: string
  reason: 'too_large' | 'conflict' | 'excluded' | 'unchanged' | 'error'
  detail?: string
}

export interface SyncErrorEntry {
  path: string
  msg: string
}

export interface PushReport {
  ok: true
  uploaded: string[]
  skipped: SkippedEntry[]
  conflicts: Conflict[]
  errors: SyncErrorEntry[]
}

export interface PullReport {
  ok: true
  downloaded: string[]
  renamedAsConflict: string[]
  skipped: SkippedEntry[]
  errors: SyncErrorEntry[]
}

export interface StatusReport {
  ok: true
  configured: boolean
  backend: BackendKind | ''
  remoteUrl: string
  lastSync: string
  autoPush: boolean
  autoPull: boolean
  toPush: string[]
  toPull: string[]
  conflicts: Conflict[]
  synced: number
}

export interface SetupRequest {
  backend: BackendKind
  remoteUrl: string
  username?: string
  password?: string
}

export type IpcResult<T> = ({ ok: true } & T) | { ok: false; error: string }

/** Hard-coded size cap per file. Files larger than this get skipped on push
 *  with `reason: 'too_large'`; this shields metered connections from a stray
 *  500 MB PDF. Raise cautiously — must match the CLI doc if we ever make the
 *  manifest cross-compatible. */
export const MAX_SYNC_FILE_BYTES = 100 * 1024 * 1024

/** Paths excluded from sync regardless of policy. Patterns are matched
 *  against the slash-joined path relative to `${userData}/`. */
export const HARDCODED_EXCLUDES = [
  'sync/manifest.json',
  'sync/credentials.json',
] as const

/** Substrings that excluded from sync regardless of policy. */
export const EXCLUDE_SUBSTRINGS = ['.tmp', '.DS_Store', 'Thumbs.db'] as const
