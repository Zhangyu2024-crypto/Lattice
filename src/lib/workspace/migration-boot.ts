export const LEGACY_SESSION_KEY = 'lattice.session'
export const MIGRATION_ARCHIVED_KEY = 'lattice-session-store-archived-at'

export interface MigrationCandidate {
  /** Raw JSON string pulled out of localStorage under {@link LEGACY_SESSION_KEY}. */
  raw: string
}

/**
 * Decide whether the first-run migration dialog should be shown.
 *
 * Returns `null` (no-op) when: localStorage isn't available, the legacy
 * key is missing, or a previous migration has already stamped the archive
 * marker. Returns the raw payload otherwise so the caller can pass it
 * verbatim to {@link migrateSessionStoreToWorkspace}.
 */
export function detectMigrationCandidate(): MigrationCandidate | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(LEGACY_SESSION_KEY)
    if (!raw) return null
    const archived = window.localStorage.getItem(MIGRATION_ARCHIVED_KEY)
    if (archived) return null
    // The runtime store (Zustand persist) also writes to this key using
    // `{ state: { sessions: ... } }` shape. Only trigger the migration
    // dialog for actual legacy data that lacks this wrapper.
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && 'state' in parsed) return null
    return { raw }
  } catch {
    return null
  }
}

/**
 * Stamp the archive marker and drop the legacy payload so subsequent
 * starts don't re-prompt. Idempotent — callers may invoke after a
 * successful migration run without guarding the failure path.
 */
export function finalizeMigration(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(MIGRATION_ARCHIVED_KEY, String(Date.now()))
    window.localStorage.removeItem(LEGACY_SESSION_KEY)
  } catch {
    // localStorage is quota-limited / blocked in some contexts; silently
    // swallow since the worst case is re-prompting next boot.
  }
}

/**
 * `true` when the current runtime can migrate in a way that actually
 * persists (needs the Electron directory picker + real fs). Memory-only
 * fs backends flatten the migrated data on reload, so we skip the dialog
 * there rather than mislead the user into "migrating" to a transient root.
 */
export function canMigrateInCurrentRuntime(): boolean {
  if (typeof window === 'undefined') return false
  const api = (
    window as unknown as {
      electronAPI?: {
        openDirectory?: unknown
        workspaceRootSet?: unknown
      }
    }
  ).electronAPI
  return (
    !!api &&
    typeof api.openDirectory === 'function' &&
    typeof api.workspaceRootSet === 'function'
  )
}
