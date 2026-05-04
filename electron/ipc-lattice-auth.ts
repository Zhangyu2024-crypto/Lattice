import { BrowserWindow, ipcMain, shell } from 'electron'
import crypto from 'node:crypto'
import {
  clearLatticeAuthSession,
  getLatticeAuthSessionSummary,
  saveLatticeAuthSession,
  type LatticeAuthSessionSummary,
} from './lattice-auth-store'

const CLIENT_ID = 'lattice-desktop'
const CALLBACK_PATH = '/oauth/callback'
const LOGIN_TIMEOUT_MS = 5 * 60_000
const DEFAULT_AUTH_BASE_URL =
  process.env.LATTICE_BLOG_AUTH_BASE_URL ?? 'https://chaxiejun.xyz/_auth'

type LatticeAuthLoginResult =
  | (Extract<LatticeAuthSessionSummary, { authenticated: true }> & { ok: true })
  | { ok: false; error: string }

interface PendingCallback {
  code: string
  state: string
}

function base64url(bytes: Buffer): string {
  return bytes.toString('base64url')
}

function sha256Base64url(value: string): string {
  return base64url(crypto.createHash('sha256').update(value, 'ascii').digest())
}

function normalizeAuthBase(raw: unknown): string {
  const input = typeof raw === 'string' && raw.trim()
    ? raw.trim()
    : DEFAULT_AUTH_BASE_URL
  const url = new URL(input)
  if (url.protocol !== 'https:' && !isLocalDevUrl(url)) {
    throw new Error('Blog auth URL must use HTTPS.')
  }
  if (url.pathname === '/' || url.pathname === '') {
    url.pathname = '/_auth'
  }
  url.hash = ''
  url.search = ''
  return url.toString().replace(/\/+$/, '')
}

function isLocalDevUrl(url: URL): boolean {
  return (
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  )
}

function isLoopbackCallbackUrl(url: URL): boolean {
  return (
    (url.hostname === '127.0.0.1' || url.hostname === 'localhost') &&
    url.pathname === CALLBACK_PATH
  )
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text()
  if (!text) return {}
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return { error: text.slice(0, 500) }
  }
}

function waitForEmbeddedCallback(
  authorizeUrl: URL,
  expectedState: string,
  expectedAuthOrigin: string,
  parent: BrowserWindow | null,
): Promise<PendingCallback> {
  return new Promise((resolve, reject) => {
    let done = false
    const authWindow = new BrowserWindow({
      width: 980,
      height: 760,
      minWidth: 720,
      minHeight: 560,
      parent: parent ?? undefined,
      modal: false,
      title: 'Lattice sign in',
      backgroundColor: '#1e1e1e',
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        partition: `lattice-auth-${Date.now()}-${crypto.randomUUID()}`,
      },
    })

    const finish = (err: Error | null, callback?: PendingCallback) => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (!authWindow.isDestroyed()) {
        authWindow.close()
      }
      if (err) reject(err)
      else if (callback) resolve(callback)
    }

    const timer = setTimeout(() => {
      finish(new Error('Login timed out.'))
    }, LOGIN_TIMEOUT_MS)

    const handlePossibleCallback = (rawUrl: string): boolean => {
      let url: URL
      try {
        url = new URL(rawUrl)
      } catch {
        return false
      }
      if (!isLoopbackCallbackUrl(url)) return false
      const code = url.searchParams.get('code') ?? ''
      const state = url.searchParams.get('state') ?? ''
      if (!code || state !== expectedState) {
        finish(new Error('Invalid authorization callback.'))
        return true
      }
      finish(null, { code, state })
      return true
    }

    authWindow.webContents.on('will-navigate', (event, url) => {
      if (handlePossibleCallback(url)) {
        event.preventDefault()
      }
    })

    authWindow.webContents.on('will-redirect', (event, url) => {
      if (handlePossibleCallback(url)) {
        event.preventDefault()
      }
    })

    authWindow.webContents.on('did-fail-load', (_event, _code, _desc, url) => {
      handlePossibleCallback(url)
    })

    authWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (handlePossibleCallback(url)) return { action: 'deny' }
      try {
        const next = new URL(url)
        if (next.origin === expectedAuthOrigin) {
          authWindow.loadURL(url).catch((err) => finish(err))
        } else {
          shell.openExternal(url).catch(() => {})
        }
      } catch {
        // Ignore malformed popup URLs from the auth page.
      }
      return { action: 'deny' }
    })

    authWindow.on('closed', () => {
      if (!done) finish(new Error('Login window was closed.'))
    })

    authWindow.loadURL(authorizeUrl.toString()).catch((err) => finish(err))
  })
}

async function login(
  rawAuthBaseUrl: unknown,
  parent: BrowserWindow | null,
): Promise<LatticeAuthLoginResult> {
  try {
    const authBaseUrl = normalizeAuthBase(rawAuthBaseUrl)
    const verifier = base64url(crypto.randomBytes(64)).slice(0, 96)
    const challenge = sha256Base64url(verifier)
    const state = base64url(crypto.randomBytes(32))

    const port = crypto.randomInt(20_000, 65_000)
    const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`

    const beginRes = await fetch(`${authBaseUrl}/api/lattice/desktop/auth/begin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        state,
      }),
    })
    const begin = await readJson(beginRes)
    if (!beginRes.ok || typeof begin.authorize_url !== 'string') {
      throw new Error(String(begin.error ?? 'Could not start blog login.'))
    }
    const authorizeUrl = new URL(begin.authorize_url)
    const expectedAuthOrigin = new URL(authBaseUrl).origin
    if (authorizeUrl.origin !== expectedAuthOrigin) {
      throw new Error('Blog returned an authorization URL on a different origin.')
    }

    const callback = await waitForEmbeddedCallback(
      authorizeUrl,
      state,
      expectedAuthOrigin,
      parent,
    )

    const tokenRes = await fetch(`${authBaseUrl}/api/lattice/desktop/auth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        code: callback.code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }),
    })
    const token = await readJson(tokenRes)
    if (!tokenRes.ok || typeof token.access_token !== 'string') {
      throw new Error(String(token.error ?? 'Could not exchange authorization code.'))
    }
    if (
      typeof token.username !== 'string' ||
      typeof token.key_id !== 'string' ||
      typeof token.key_prefix !== 'string'
    ) {
      throw new Error('Blog returned an incomplete Lattice token response.')
    }
    const returnedBaseUrl =
      typeof token.base_url === 'string' ? token.base_url.trim() : ''
    const baseUrl = returnedBaseUrl.startsWith(`${authBaseUrl}/`)
      ? returnedBaseUrl
      : `${authBaseUrl}/api/lattice/v1`

    const summary = await saveLatticeAuthSession({
      accessToken: token.access_token,
      baseUrl,
      username: token.username,
      keyId: token.key_id,
      keyPrefix: token.key_prefix,
    })
    if (!summary.authenticated) {
      throw new Error('Could not persist Lattice token.')
    }
    return { ok: true, ...summary }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }
}

export function registerLatticeAuthIpc(): void {
  ipcMain.handle('lattice-auth:get-session', async () => {
    return getLatticeAuthSessionSummary()
  })

  ipcMain.handle('lattice-auth:login', async (event, payload: unknown) => {
    const authBaseUrl =
      payload && typeof payload === 'object'
        ? (payload as { authBaseUrl?: unknown }).authBaseUrl
        : undefined
    const parent = BrowserWindow.fromWebContents(event.sender)
    return login(authBaseUrl, parent)
  })

  ipcMain.handle('lattice-auth:logout', async () => {
    await clearLatticeAuthSession()
    return { ok: true }
  })
}
