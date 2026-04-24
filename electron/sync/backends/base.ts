// Base backend contract + shared error taxonomy.
// Re-exported from `sync/types` so implementations don't have to import
// across two paths. Declared here so new backends (rclone, future providers)
// can `import type { CloudBackend }` without pulling in the manifest types.

export type { CloudBackend, RemoteFileInfo, BackendKind } from '../types'

export class BackendError extends Error {
  constructor(
    message: string,
    public readonly kind:
      | 'network'
      | 'auth'
      | 'not_found'
      | 'forbidden'
      | 'quota'
      | 'binary_missing'
      | 'protocol'
      | 'unknown',
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'BackendError'
  }
}
