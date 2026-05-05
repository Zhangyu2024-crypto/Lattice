import { useEffect, useMemo, useState } from 'react'
import { errorMessage } from '../../lib/error-message'
import { formatRelativeTime } from '../../lib/format-time'
import { LATTICE_AUTH_PROVIDER_ID } from '../../lib/lattice-auth-client'
import { useLLMConfigStore } from '../../stores/llm-config-store'
import { useUsageStore } from '../../stores/usage-store'
import type { LatticeAuthSessionPayload } from '../../types/electron'
import type { BudgetConfig, UsageAggregate, UsageRecord } from '../../types/llm'

type AuthenticatedSession = Extract<LatticeAuthSessionPayload, { authenticated: true }>

const EMPTY_AGG: UsageAggregate = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUSD: 0,
}

export type AccountProviderTone = 'ok' | 'warn' | 'off'

export function useAccountStats() {
  const [checking, setChecking] = useState(true)
  const [session, setSession] = useState<LatticeAuthSessionPayload | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)

  const providers = useLLMConfigStore((s) => s.providers)
  const budget = useLLMConfigStore((s) => s.budget)
  const getTodayTotals = useUsageStore((s) => s.getTodayTotals)
  const getAllTimeTotals = useUsageStore((s) => s.getAllTimeTotals)
  const records = useUsageStore((s) => s.records)

  const refreshSession = async () => {
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
  }

  useEffect(() => {
    void refreshSession()
  }, [])

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

  const authSession: AuthenticatedSession | null =
    session?.authenticated === true ? session : null
  const authenticated = authSession !== null
  const latticeProvider = providers.find((p) => p.id === LATTICE_AUTH_PROVIDER_ID)
  const enabledProviders = providers.filter((p) => p.enabled).length
  const totalModels = providers.reduce((sum, provider) => sum + provider.models.length, 0)
  const lastRecord = records.length > 0 ? records[records.length - 1] : null
  const totalTodayTokens = today.inputTokens + today.outputTokens
  const tokenPct = budget.daily.tokenLimit
    ? Math.min(1, totalTodayTokens / budget.daily.tokenLimit)
    : 0
  const costPct = budget.daily.costLimitUSD
    ? Math.min(1, today.costUSD / budget.daily.costLimitUSD)
    : 0
  const budgetPct = Math.max(tokenPct, costPct)

  const providerTone: AccountProviderTone = !authenticated
    ? 'off'
    : !latticeProvider || !latticeProvider.enabled || latticeProvider.models.length === 0
      ? 'warn'
      : 'ok'
  const providerStatus = !authenticated
    ? 'Signed out'
    : !latticeProvider
      ? 'Connection missing'
      : !latticeProvider.enabled
        ? 'Connection disabled'
        : latticeProvider.models.length === 0
          ? 'Setup pending'
          : 'Ready'
  const totalAllTimeTokens = allTime.inputTokens + allTime.outputTokens
  const accountName = authenticated
    ? authSession.username
    : checking
      ? 'Checking account'
      : 'Not signed in'
  const accountSubtitle = authenticated
    ? `Signed in via ${hostLabel(authSession.baseUrl)}`
    : sessionError ?? 'Desktop session not connected'
  const sessionLabel = authenticated ? 'Connected' : 'Not connected'
  const sessionDetail = authenticated
    ? `Saved locally ${formatRelativeDate(authSession.savedAt)}`
    : 'Sign in with chaxiejun.xyz to enable Lattice'
  const serviceLabel = authenticated
    ? latticeProvider?.enabled && latticeProvider.models.length > 0
      ? 'chaxiejun.xyz ready'
      : 'Setup pending'
    : 'Connect chaxiejun.xyz'
  const serviceDetail = authenticated
    ? latticeProvider?.enabled && latticeProvider.models.length > 0
      ? 'Lattice will work through your account'
      : 'Open Connections to finish account setup'
    : 'Connect once, then use Lattice directly'
  const providerLabel = providerStatus
  const providerDetail = !authenticated
    ? 'Sign in to enable the account connection'
    : latticeProvider?.enabled
      ? 'Connected through chaxiejun.xyz'
      : 'Open Connections to finish setup'
  const todayUsageLabel = `${formatTokens(totalTodayTokens)} tokens`
  const todayUsageDetail = `${today.calls} calls · ${formatUSD(today.costUSD)}`
  const allTimeUsageLabel = `${formatTokens(totalAllTimeTokens)} tokens`
  const allTimeUsageDetail = `${allTime.calls} calls · ${formatUSD(allTime.costUSD)}`

  return {
    checking,
    session,
    authSession,
    sessionError,
    authenticated,
    latticeProvider,
    providers,
    enabledProviders,
    totalModels,
    budget,
    budgetPct,
    today,
    allTime,
    totalTodayTokens,
    totalAllTimeTokens,
    lastRecord,
    providerTone,
    providerStatus,
    accountName,
    accountSubtitle,
    sessionLabel,
    sessionDetail,
    serviceLabel,
    serviceDetail,
    providerLabel,
    providerDetail,
    todayUsageLabel,
    todayUsageDetail,
    allTimeUsageLabel,
    allTimeUsageDetail,
    refreshSession,
  }
}

export function hostLabel(value: string): string {
  try {
    return new URL(value).host
  } catch {
    return value || 'chaxiejun.xyz'
  }
}

export function formatRelativeDate(value: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return 'recently'
  return formatRelativeTime(timestamp)
}

export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n < 1000) return `${Math.round(n)}`
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

export function formatUSD(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0.00'
  if (Math.abs(n) < 0.01) return '<$0.01'
  return `$${n.toFixed(2)}`
}

export function dailyBudgetLabel(daily: BudgetConfig['daily']): string {
  const parts = [
    daily.tokenLimit ? `${formatTokens(daily.tokenLimit)} token limit` : null,
    daily.costLimitUSD ? `${formatUSD(daily.costLimitUSD)} cost limit` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : 'No daily budget set'
}

export function colorForPct(pct: number): string {
  if (pct < 0.5) return 'var(--color-green)'
  if (pct < 0.8) return 'var(--color-accent)'
  if (pct < 0.95) return 'var(--color-yellow)'
  return 'var(--color-red)'
}

export function lastCallLabel(record: Pick<UsageRecord, 'timestamp' | 'success'> | null): string {
  if (!record) return 'No calls yet'
  const when = formatRelativeTime(record.timestamp)
  return `${record.success ? 'OK' : 'Failed'}${when ? ` · ${when}` : ''}`
}
