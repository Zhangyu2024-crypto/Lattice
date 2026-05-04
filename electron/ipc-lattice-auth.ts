import { ipcMain, shell } from 'electron'
import crypto from 'node:crypto'
import http from 'node:http'
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
  process.env.LATTICE_BLOG_AUTH_BASE_URL ?? 'https://blog.chaxiejun.xyz/_auth'

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

function waitForCallback(
  server: http.Server,
  expectedState: string,
): Promise<PendingCallback> {
  return new Promise((resolve, reject) => {
    let done = false
    const finish = (err: Error | null, callback?: PendingCallback) => {
      if (done) return
      done = true
      clearTimeout(timer)
      server.close()
      if (err) reject(err)
      else if (callback) resolve(callback)
    }

    const timer = setTimeout(() => {
      finish(new Error('Login timed out.'))
    }, LOGIN_TIMEOUT_MS)

    server.on('request', (req, res) => {
      const rawUrl = req.url ?? '/'
      const url = new URL(rawUrl, 'http://127.0.0.1')
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('Not found')
        return
      }
      const code = url.searchParams.get('code') ?? ''
      const state = url.searchParams.get('state') ?? ''
      if (!code || state !== expectedState) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
        res.end(doneHtml('登录失败', '授权回调参数无效，可以关闭此页面。'))
        finish(new Error('Invalid authorization callback.'))
        return
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(doneHtml('登录完成', '可以回到 Lattice 桌面应用继续使用。'))
      finish(null, { code, state })
    })

    server.on('error', (err) => {
      finish(err)
    })

    server.on('close', () => {
      if (!done) finish(new Error('Login callback server closed.'))
    })
  })
}

function doneHtml(title: string, body: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#111;color:#f5f5f5}main{max-width:28rem;padding:2rem}h1{font-size:1.2rem;margin:0 0 .5rem}p{margin:0;color:#b5b5b5;line-height:1.6}</style></head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Could not allocate local callback port.'))
        return
      }
      resolve(address.port)
    })
  })
}

async function login(rawAuthBaseUrl: unknown): Promise<LatticeAuthLoginResult> {
  let server: http.Server | null = null
  try {
    const authBaseUrl = normalizeAuthBase(rawAuthBaseUrl)
    const verifier = base64url(crypto.randomBytes(64)).slice(0, 96)
    const challenge = sha256Base64url(verifier)
    const state = base64url(crypto.randomBytes(32))

    server = http.createServer()
    const port = await listen(server)
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

    const callbackPromise = waitForCallback(server, state)
    await shell.openExternal(authorizeUrl.toString())
    const callback = await callbackPromise

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
    if (server?.listening) server.close()
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }
}

export function registerLatticeAuthIpc(): void {
  ipcMain.handle('lattice-auth:get-session', async () => {
    return getLatticeAuthSessionSummary()
  })

  ipcMain.handle('lattice-auth:login', async (_event, payload: unknown) => {
    const authBaseUrl =
      payload && typeof payload === 'object'
        ? (payload as { authBaseUrl?: unknown }).authBaseUrl
        : undefined
    return login(authBaseUrl)
  })

  ipcMain.handle('lattice-auth:logout', async () => {
    await clearLatticeAuthSession()
    return { ok: true }
  })
}
