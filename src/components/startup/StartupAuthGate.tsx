import { useEffect, useState, type ReactNode } from 'react'
import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  LogIn,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import Button from '../ui/Button'
import ToastHost from '../common/ToastHost'
import LogConsole from '../common/LogConsole'
import { errorMessage } from '@/lib/error-message'
import {
  connectLatticeAuthProviderModels,
  upsertLatticeAuthProvider,
  type AuthenticatedLatticeSession,
} from '@/lib/lattice-auth-client'
import { toast } from '@/stores/toast-store'
import type { LatticeAuthSessionPayload } from '@/types/electron'

type AuthState =
  | { status: 'checking' }
  | { status: 'missing' }
  | { status: 'setting-up'; session: AuthenticatedLatticeSession }
  | { status: 'ready'; session: AuthenticatedLatticeSession }
  | { status: 'error'; message: string }
  | {
      status: 'setup-error'
      session: AuthenticatedLatticeSession
      message: string
      statusCode?: number
    }

interface Props {
  children: ReactNode
}

export default function StartupAuthGate({ children }: Props) {
  const [state, setState] = useState<AuthState>({ status: 'checking' })
  const [loginRunning, setLoginRunning] = useState(false)

  const setupSession = async (
    session: AuthenticatedLatticeSession,
    cancelled?: () => boolean,
  ) => {
    upsertLatticeAuthProvider(session)
    if (cancelled?.()) return
    setState({ status: 'setting-up', session })
    try {
      const connected = await connectLatticeAuthProviderModels(session)
      if (cancelled?.()) return
      if (!connected.ok) {
        const suffix = connected.status ? ` (HTTP ${connected.status})` : ''
        toast.warn(`Signed in as ${session.username}. Model setup can be retried later: ${connected.message}${suffix}`)
        setState({ status: 'ready', session })
        return
      }
      if (connected.provider.models.length === 0) {
        toast.warn(
          'Signed in, but chaxiejun.xyz returned no models for this desktop credential.',
        )
        setState({ status: 'ready', session })
        return
      }
      setState({ status: 'ready', session })
    } catch (err) {
      if (!cancelled?.()) {
        setState({
          status: 'setup-error',
          session,
          message: errorMessage(err),
        })
      }
    }
  }

  useEffect(() => {
    let cancelled = false
    const api = window.electronAPI
    if (!api?.latticeAuthGetSession) {
      setState({ status: 'missing' })
      return
    }
    api.latticeAuthGetSession()
      .then((session: LatticeAuthSessionPayload) => {
        if (cancelled) return
        if (session.authenticated) {
          void setupSession(session, () => cancelled)
        } else {
          setState({ status: 'missing' })
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setState({ status: 'error', message: errorMessage(err) })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleLogin = async () => {
    const api = window.electronAPI
    if (!api?.latticeAuthLogin) {
      setState({
        status: 'error',
        message: 'Desktop authentication is only available in Electron.',
      })
      return
    }
    setLoginRunning(true)
    setState({ status: 'missing' })
    try {
      const result = await api.latticeAuthLogin()
      if (!result.ok) {
        setState({ status: 'error', message: result.error })
        return
      }
      setLoginRunning(false)
      await setupSession(result)
    } catch (err) {
      setState({ status: 'error', message: errorMessage(err) })
    } finally {
      setLoginRunning(false)
    }
  }

  const handleRetrySetup = async () => {
    if (state.status !== 'setup-error') return
    await setupSession(state.session)
  }

  if (state.status === 'ready') return <>{children}</>

  const busy =
    loginRunning || state.status === 'checking' || state.status === 'setting-up'
  const statusMessage =
    state.status === 'checking'
      ? 'Checking the secure desktop session.'
      : state.status === 'setting-up'
        ? `Preparing the model provider for ${state.session.username}.`
        : state.status === 'setup-error'
          ? `Signed in as ${state.session.username}, but model setup did not finish.`
          : null

  return (
    <div className="startup-auth-root">
      <div className="startup-auth-shell">
        <section className="startup-auth-main">
          <div className="startup-auth-brand-row">
            <div>
              <div className="startup-auth-product">Lattice</div>
              <div className="startup-auth-origin">chaxiejun.xyz account</div>
            </div>
          </div>

          <div className="startup-auth-copy">
            <h1>Connect your research workspace</h1>
            <p>
              Sign in on chaxiejun.xyz to issue a desktop credential for
              Lattice. The local app stores the credential for later Lattice
              service calls and can refresh model setup after login.
            </p>
          </div>

          <div>
            <div className="startup-auth-actions">
              <Button
                variant="primary"
                size="md"
                onClick={handleLogin}
                disabled={busy}
                leading={
                  busy
                    ? <Loader2 size={16} className="startup-auth-spin" />
                    : <LogIn size={16} />
                }
              >
                {state.status === 'checking'
                  ? 'Checking session'
                  : state.status === 'setting-up'
                    ? 'Setting up provider'
                  : loginRunning
                    ? 'Waiting for browser login'
                    : 'Login with chaxiejun.xyz'}
              </Button>
              {state.status === 'setup-error' && (
                <>
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={handleRetrySetup}
                    leading={<RefreshCw size={15} />}
                  >
                    Retry setup
                  </Button>
                  <Button
                    variant="ghost"
                    size="md"
                    onClick={() =>
                      setState({ status: 'ready', session: state.session })
                    }
                  >
                    Continue
                  </Button>
                </>
              )}
              <a
                className="startup-auth-link"
                href="https://chaxiejun.xyz"
                target="_blank"
                rel="noreferrer"
              >
                Open website
                <ExternalLink size={13} />
              </a>
            </div>

            {statusMessage && (
              <div className="startup-auth-status" role="status">
                {state.status === 'setting-up' && (
                  <Loader2 size={14} className="startup-auth-spin" />
                )}
                <span>{statusMessage}</span>
              </div>
            )}

            {state.status === 'error' && (
              <div className="startup-auth-error" role="alert">
                {state.message}
              </div>
            )}
            {state.status === 'setup-error' && (
              <div className="startup-auth-error" role="alert">
                {state.message}
                {state.statusCode ? ` (HTTP ${state.statusCode})` : ''}
              </div>
            )}
          </div>
        </section>

        <aside className="startup-auth-panel">
          <div className="startup-auth-panel-header">
            <ShieldCheck size={18} />
            <span>What happens next</span>
          </div>
          <div className="startup-auth-steps">
            <div className="startup-auth-step">
              <KeyRound size={15} />
              <div>
                <strong>Browser authentication</strong>
                <span>
                  Lattice opens a chaxiejun.xyz sign-in window and waits for
                  authorization.
                </span>
              </div>
            </div>
            <div className="startup-auth-step">
              <CheckCircle2 size={15} />
              <div>
                <strong>Credential handoff</strong>
                <span>
                  The desktop token is encrypted and never shown in the renderer.
                </span>
              </div>
            </div>
            <div className="startup-auth-step">
              <CheckCircle2 size={15} />
              <div>
                <strong>Provider setup</strong>
                <span>
                  A chaxiejun.xyz provider is enabled; model catalog setup can
                  be retried from Settings.
                </span>
              </div>
            </div>
          </div>
        </aside>
      </div>
      <ToastHost />
      <LogConsole />
    </div>
  )
}
