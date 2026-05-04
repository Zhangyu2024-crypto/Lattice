import electron from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export const LATTICE_AUTH_API_KEY_REF = 'lattice-secure-token'

export interface LatticeAuthSession {
  accessToken: string
  baseUrl: string
  username: string
  keyId: string
  keyPrefix: string
  savedAt: string
}

export type LatticeAuthSessionSummary =
  | {
      authenticated: true
      baseUrl: string
      username: string
      keyId: string
      keyPrefix: string
      savedAt: string
    }
  | { authenticated: false }

const STORE_FILE = 'lattice-blog-auth.json'

function electronRuntime(): {
  app: Electron.App
  safeStorage: Electron.SafeStorage
} {
  const runtime = electron as unknown as {
    app?: Electron.App
    safeStorage?: Electron.SafeStorage
  }
  if (!runtime.app || !runtime.safeStorage) {
    throw new Error('Electron secure credential storage is not available.')
  }
  return { app: runtime.app, safeStorage: runtime.safeStorage }
}

function storePath(): string {
  const { app } = electronRuntime()
  return path.join(app.getPath('userData'), STORE_FILE)
}

function ensureEncryptionAvailable(): void {
  const { safeStorage } = electronRuntime()
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure credential storage is not available on this OS session.')
  }
}

function summarize(session: LatticeAuthSession): LatticeAuthSessionSummary {
  return {
    authenticated: true,
    baseUrl: session.baseUrl,
    username: session.username,
    keyId: session.keyId,
    keyPrefix: session.keyPrefix,
    savedAt: session.savedAt,
  }
}

export async function saveLatticeAuthSession(
  session: Omit<LatticeAuthSession, 'savedAt'>,
): Promise<LatticeAuthSessionSummary> {
  ensureEncryptionAvailable()
  const { safeStorage } = electronRuntime()
  const filePath = storePath()
  const full: LatticeAuthSession = {
    ...session,
    savedAt: new Date().toISOString(),
  }
  const encrypted = safeStorage.encryptString(JSON.stringify(full))
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(
    filePath,
    JSON.stringify({ version: 1, data: encrypted.toString('base64') }),
    { encoding: 'utf-8', mode: 0o600 },
  )
  return summarize(full)
}

export async function loadLatticeAuthSession(): Promise<LatticeAuthSession | null> {
  try {
    const filePath = storePath()
    const raw = await fs.readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as { data?: unknown }
    if (typeof parsed.data !== 'string' || !parsed.data) return null
    ensureEncryptionAvailable()
    const { safeStorage } = electronRuntime()
    const decrypted = safeStorage.decryptString(Buffer.from(parsed.data, 'base64'))
    const session = JSON.parse(decrypted) as Partial<LatticeAuthSession>
    if (
      typeof session.accessToken !== 'string' ||
      typeof session.baseUrl !== 'string' ||
      typeof session.username !== 'string' ||
      typeof session.keyId !== 'string' ||
      typeof session.keyPrefix !== 'string' ||
      typeof session.savedAt !== 'string'
    ) {
      return null
    }
    return session as LatticeAuthSession
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code
    if (code === 'ENOENT') return null
    throw err
  }
}

export async function getLatticeAuthSessionSummary(): Promise<LatticeAuthSessionSummary> {
  const session = await loadLatticeAuthSession()
  return session ? summarize(session) : { authenticated: false }
}

export async function clearLatticeAuthSession(): Promise<void> {
  try {
    const filePath = storePath()
    await fs.unlink(filePath)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code
    if (code !== 'ENOENT') throw err
  }
}

export async function resolveLatticeApiKey(apiKey: string): Promise<string> {
  if (apiKey !== LATTICE_AUTH_API_KEY_REF) return apiKey
  const session = await loadLatticeAuthSession()
  if (!session?.accessToken) {
    throw new Error('Lattice blog login is missing. Log in from Settings -> Models.')
  }
  return session.accessToken
}
