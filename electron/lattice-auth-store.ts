import electron from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export const LATTICE_AUTH_API_KEY_REF = 'lattice-secure-token'
export const LATTICE_AUTH_ENDPOINT_ERROR =
  'Lattice credential can only be used with the signed-in chaxiejun.xyz endpoint.'

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
  safeStorage?: Electron.SafeStorage
} {
  const runtime = electron as unknown as {
    app?: Electron.App
    safeStorage?: Electron.SafeStorage
  }
  if (!runtime.app) {
    throw new Error('Electron app storage is not available.')
  }
  return { app: runtime.app, safeStorage: runtime.safeStorage }
}

function storePath(): string {
  const { app } = electronRuntime()
  return path.join(app.getPath('userData'), STORE_FILE)
}

function encryptionAvailable(): boolean {
  const { safeStorage } = electronRuntime()
  try {
    return Boolean(safeStorage?.isEncryptionAvailable())
  } catch {
    return false
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
  const { safeStorage } = electronRuntime()
  const filePath = storePath()
  const full: LatticeAuthSession = {
    ...session,
    savedAt: new Date().toISOString(),
  }
  let payload: { version: 1; storage: 'safeStorage' | 'plaintext-file'; data: string | LatticeAuthSession }
  if (encryptionAvailable() && safeStorage) {
    try {
      payload = {
        version: 1,
        storage: 'safeStorage',
        data: safeStorage.encryptString(JSON.stringify(full)).toString('base64'),
      }
    } catch {
      payload = {
        version: 1,
        storage: 'plaintext-file',
        data: full,
      }
    }
  } else {
    payload = {
      version: 1,
      storage: 'plaintext-file',
      data: full,
    }
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(
    filePath,
    JSON.stringify(payload),
    { encoding: 'utf-8', mode: 0o600 },
  )
  return summarize(full)
}

function parseSession(raw: unknown): LatticeAuthSession | null {
  const session = raw as Partial<LatticeAuthSession>
  if (
    typeof session?.accessToken !== 'string' ||
    typeof session.baseUrl !== 'string' ||
    typeof session.username !== 'string' ||
    typeof session.keyId !== 'string' ||
    typeof session.keyPrefix !== 'string' ||
    typeof session.savedAt !== 'string'
  ) {
    return null
  }
  return session as LatticeAuthSession
}

export async function loadLatticeAuthSession(): Promise<LatticeAuthSession | null> {
  try {
    const filePath = storePath()
    const raw = await fs.readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as { data?: unknown; storage?: unknown }
    if (parsed.storage === 'plaintext-file') {
      return parseSession(parsed.data)
    }
    if (typeof parsed.data !== 'string' || !parsed.data) return null
    const { safeStorage } = electronRuntime()
    if (!encryptionAvailable() || !safeStorage) {
      return null
    }
    try {
      const decrypted = safeStorage.decryptString(Buffer.from(parsed.data, 'base64'))
      return parseSession(JSON.parse(decrypted))
    } catch {
      return null
    }
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

interface NormalizedBaseUrl {
  origin: string
  pathname: string
}

function normalizeBaseUrlForPolicy(raw: string): NormalizedBaseUrl | null {
  const input = raw.trim()
  if (!input) return null
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }
  if (url.username || url.password || url.search || url.hash) return null
  if (url.protocol !== 'https:' && !isLocalDevUrl(url)) return null
  const pathname = url.pathname.replace(/\/+$/, '')
  return {
    origin: url.origin,
    pathname: pathname === '/' ? '' : pathname,
  }
}

function isLocalDevUrl(url: URL): boolean {
  return (
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  )
}

export function isLatticeRequestBaseUrlAllowed(
  requestBaseUrl: string,
  sessionBaseUrl: string,
): boolean {
  const request = normalizeBaseUrlForPolicy(requestBaseUrl)
  const session = normalizeBaseUrlForPolicy(sessionBaseUrl)
  if (!request || !session) return false
  return request.origin === session.origin && request.pathname === session.pathname
}

export async function resolveLatticeApiKeyForRequest(
  apiKey: string,
  baseUrl: string,
): Promise<string> {
  if (apiKey.trim() !== LATTICE_AUTH_API_KEY_REF) return apiKey
  const session = await loadLatticeAuthSession()
  if (!session?.accessToken) {
    throw new Error('Lattice blog login is missing. Log in from Settings -> Models.')
  }
  if (!isLatticeRequestBaseUrlAllowed(baseUrl, session.baseUrl)) {
    throw new Error(LATTICE_AUTH_ENDPOINT_ERROR)
  }
  return session.accessToken
}
