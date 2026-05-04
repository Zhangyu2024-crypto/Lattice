import {
  CircleUserRound,
  Cpu,
  Database,
  ExternalLink,
  Gauge,
  KeyRound,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { useOutsideClickDismiss } from '../../hooks/useOutsideClickDismiss'
import { errorMessage } from '../../lib/error-message'
import { formatRelativeTime } from '../../lib/format-time'
import { LATTICE_AUTH_PROVIDER_ID } from '../../lib/lattice-auth-client'
import { useLLMConfigStore, useResolvedModel } from '../../stores/llm-config-store'
import { useUsageStore } from '../../stores/usage-store'
import type { LatticeAuthSessionPayload } from '../../types/electron'
import type { UsageAggregate } from '../../types/llm'

interface Props {
  onOpenSettings: () => void
}

const EMPTY_AGG: UsageAggregate = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUSD: 0,
}

const POPOVER_WIDTH = 328
const POPOVER_MARGIN = 8

export default function AccountStatsMenu({ onOpenSettings }: Props) {
  const [open, setOpen] = useState(false)
  const [checking, setChecking] = useState(true)
  const [session, setSession] = useState<LatticeAuthSessionPayload | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)

  const providers = useLLMConfigStore((s) => s.providers)
  const budget = useLLMConfigStore((s) => s.budget)
  const resolved = useResolvedModel('agent')
  const getTodayTotals = useUsageStore((s) => s.getTodayTotals)
  const getAllTimeTotals = useUsageStore((s) => s.getAllTimeTotals)
  const records = useUsageStore((s) => s.records)

  const refreshSession = useCallback(async () => {
    setChecking(true)
    setSessionError(null)
    const api = window.electronAPI
    if (!api?.latticeAuthGetSession) {
      setSession({ authenticated: false })
      setChecking(false)
      return
    }
    try {
      setSession(await api.latticeAuthGetSession())
    } catch (err) {
      setSession(null)
      setSessionError(errorMessage(err))
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    void refreshSession()
  }, [refreshSession])

  useEffect(() => {
    if (open) void refreshSession()
  }, [open, refreshSession])

  useOutsideClickDismiss(
    popoverRef,
    open,
    () => setOpen(false),
    buttonRef,
  )

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const authenticated = session?.authenticated === true
  const latticeProvider = providers.find((p) => p.id === LATTICE_AUTH_PROVIDER_ID)
  const enabledProviders = providers.filter((p) => p.enabled).length
  const totalModels = providers.reduce((sum, provider) => sum + provider.models.length, 0)
  const lastRecord = records.length > 0 ? records[records.length - 1] : null

  const today = useMemo(() => {
    try {
      return getTodayTotals() ?? EMPTY_AGG
    } catch {
      return EMPTY_AGG
    }
    // records invalidates the derived getter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getTodayTotals, records])

  const allTime = useMemo(() => {
    try {
      return getAllTimeTotals() ?? EMPTY_AGG
    } catch {
      return EMPTY_AGG
    }
    // records invalidates the derived getter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getAllTimeTotals, records])

  const totalTodayTokens = today.inputTokens + today.outputTokens
  const tokenPct = budget.daily.tokenLimit
    ? Math.min(1, totalTodayTokens / budget.daily.tokenLimit)
    : 0
  const costPct = budget.daily.costLimitUSD
    ? Math.min(1, today.costUSD / budget.daily.costLimitUSD)
    : 0
  const budgetPct = Math.max(tokenPct, costPct)

  const providerTone = !authenticated
    ? 'off'
    : !latticeProvider || !latticeProvider.enabled || latticeProvider.models.length === 0
      ? 'warn'
      : 'ok'
  const providerStatus = !authenticated
    ? 'Signed out'
    : !latticeProvider
      ? 'Provider missing'
      : !latticeProvider.enabled
        ? 'Provider disabled'
        : latticeProvider.models.length === 0
          ? 'Models pending'
          : 'Ready'
  const buttonTitle = authenticated
    ? `${session.username} account statistics`
    : 'Account statistics'

  const position = useMemo(() => accountPopoverPosition(buttonRef.current), [open])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`activity-btn activity-account-btn ${open ? 'active' : ''}`}
        onClick={() => setOpen((value) => !value)}
        title={buttonTitle}
        aria-label={buttonTitle}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <CircleUserRound
          size={20}
          strokeWidth={1.65}
          className="activity-icon"
          aria-hidden
        />
        <span
          className={`activity-account-dot activity-account-dot--${providerTone}`}
          aria-hidden
        />
      </button>

      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Account statistics"
          className="account-stats-popover"
          style={
            {
              '--account-popover-left': `${position.left}px`,
              '--account-popover-bottom': `${position.bottom}px`,
            } as CSSProperties
          }
        >
          <div className="account-stats-header">
            <div className="account-stats-avatar" aria-hidden>
              {authenticated ? session.username.slice(0, 1).toUpperCase() : '?'}
            </div>
            <div className="account-stats-title-wrap">
              <div className="account-stats-name">
                {authenticated ? session.username : checking ? 'Checking account' : 'Not signed in'}
              </div>
              <div className="account-stats-subtitle">
                {authenticated
                  ? hostLabel(session.baseUrl)
                  : sessionError ?? 'chaxiejun.xyz desktop session'}
              </div>
            </div>
            <button
              type="button"
              className="account-stats-refresh"
              onClick={() => void refreshSession()}
              title="Refresh account stats"
              aria-label="Refresh account stats"
            >
              <RefreshCw size={13} aria-hidden />
            </button>
          </div>

          <div className={`account-stats-state account-stats-state--${providerTone}`}>
            <ShieldCheck size={13} aria-hidden />
            <span>{providerStatus}</span>
          </div>

          <div className="account-stats-grid">
            <StatTile
              icon={<KeyRound size={14} />}
              label="Credential"
              value={authenticated ? session.keyPrefix : 'No session'}
              detail={
                authenticated
                  ? `Saved ${formatRelativeDate(session.savedAt)}`
                  : 'Login required'
              }
            />
            <StatTile
              icon={<Database size={14} />}
              label="chaxiejun.xyz"
              value={latticeProvider ? `${latticeProvider.models.length} models` : 'Missing'}
              detail={latticeProvider?.enabled ? 'Provider enabled' : 'Provider not ready'}
            />
            <StatTile
              icon={<Cpu size={14} />}
              label="Default model"
              value={resolved?.model.label ?? 'Not configured'}
              detail={resolved?.provider.name ?? 'Open Settings to choose'}
            />
            <StatTile
              icon={<Gauge size={14} />}
              label="Today"
              value={`${formatTokens(totalTodayTokens)} tokens`}
              detail={`${today.calls} calls · ${formatUSD(today.costUSD)}`}
            />
          </div>

          <section className="account-stats-section">
            <div className="account-stats-section-title">Daily budget</div>
            <div className="account-stats-progress">
              <span
                className="account-stats-progress-fill"
                style={
                  {
                    '--account-progress-width': `${Math.max(2, budgetPct * 100)}%`,
                    '--account-progress-bg': colorForPct(budgetPct),
                  } as CSSProperties
                }
              />
            </div>
            <div className="account-stats-row">
              <span>{dailyBudgetLabel(budget.daily.tokenLimit, budget.daily.costLimitUSD)}</span>
              <strong>{Math.round(budgetPct * 100)}%</strong>
            </div>
          </section>

          <section className="account-stats-section">
            <div className="account-stats-section-title">Workspace totals</div>
            <div className="account-stats-row">
              <span>Enabled providers</span>
              <strong>{enabledProviders} / {providers.length}</strong>
            </div>
            <div className="account-stats-row">
              <span>Available models</span>
              <strong>{totalModels}</strong>
            </div>
            <div className="account-stats-row">
              <span>All-time usage</span>
              <strong>{allTime.calls} calls · {formatUSD(allTime.costUSD)}</strong>
            </div>
            <div className="account-stats-row">
              <span>Last call</span>
              <strong>{lastCallLabel(lastRecord)}</strong>
            </div>
          </section>

          <button
            type="button"
            className="account-stats-settings"
            onClick={() => {
              setOpen(false)
              onOpenSettings()
            }}
          >
            <span>Open account and model settings</span>
            <ExternalLink size={12} aria-hidden />
          </button>
        </div>
      )}
    </>
  )
}

function StatTile({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode
  label: string
  value: string
  detail: string
}) {
  return (
    <div className="account-stats-tile">
      <div className="account-stats-tile-label">
        {icon}
        <span>{label}</span>
      </div>
      <div className="account-stats-tile-value" title={value}>{value}</div>
      <div className="account-stats-tile-detail" title={detail}>{detail}</div>
    </div>
  )
}

function accountPopoverPosition(anchorEl: HTMLElement | null): { left: number; bottom: number } {
  if (!anchorEl || typeof window === 'undefined') {
    return { left: 60, bottom: 8 }
  }
  const rect = anchorEl.getBoundingClientRect()
  return {
    left: Math.min(
      Math.max(POPOVER_MARGIN, rect.right + POPOVER_MARGIN),
      window.innerWidth - POPOVER_WIDTH - POPOVER_MARGIN,
    ),
    bottom: Math.max(POPOVER_MARGIN, window.innerHeight - rect.bottom),
  }
}

function formatRelativeDate(value: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return 'recently'
  return formatRelativeTime(timestamp)
}

function hostLabel(value: string): string {
  try {
    return new URL(value).host
  } catch {
    return value || 'chaxiejun.xyz'
  }
}

function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n < 1000) return `${Math.round(n)}`
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

function formatUSD(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0.00'
  if (Math.abs(n) < 0.01) return '<$0.01'
  return `$${n.toFixed(2)}`
}

function dailyBudgetLabel(tokenLimit: number | null, costLimitUSD: number | null): string {
  const parts = [
    tokenLimit ? `${formatTokens(tokenLimit)} token limit` : null,
    costLimitUSD ? `${formatUSD(costLimitUSD)} cost limit` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : 'No daily budget set'
}

function colorForPct(pct: number): string {
  if (pct < 0.5) return 'var(--color-green)'
  if (pct < 0.8) return 'var(--color-accent)'
  if (pct < 0.95) return 'var(--color-yellow)'
  return 'var(--color-red)'
}

function lastCallLabel(record: { timestamp: number; success: boolean } | null): string {
  if (!record) return 'No calls yet'
  const when = formatRelativeTime(record.timestamp)
  return `${record.success ? 'OK' : 'Failed'}${when ? ` · ${when}` : ''}`
}
