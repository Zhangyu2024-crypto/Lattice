import {
  Cpu,
  Database,
  Gauge,
  KeyRound,
  ShieldCheck,
} from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import {
  colorForPct,
  dailyBudgetLabel,
  formatRelativeDate,
  formatTokens,
  formatUSD,
  hostLabel,
  lastCallLabel,
  useAccountStats,
} from '../account-stats'
import { Section } from './primitives'

export default function AccountSettingsTab() {
  const stats = useAccountStats()

  return (
    <div className="settings-account-root">
      <Section title="Account">
        <div className="settings-account-hero">
          <div className="settings-account-avatar" aria-hidden>
            {stats.authenticated
              ? stats.authSession?.username.slice(0, 1).toUpperCase()
              : '?'}
          </div>
          <div className="settings-account-hero-main">
            <div className="settings-account-name">
              {stats.authenticated
                ? stats.authSession?.username
                : stats.checking
                  ? 'Checking account'
                  : 'Not signed in'}
            </div>
            <div className="settings-account-subtitle">
              {stats.authenticated
                ? hostLabel(stats.authSession?.baseUrl ?? '')
                : stats.sessionError ?? 'chaxiejun.xyz desktop session'}
            </div>
          </div>
          <div className={`settings-account-status settings-account-status--${stats.providerTone}`}>
            <ShieldCheck size={14} aria-hidden />
            <span>{stats.providerStatus}</span>
          </div>
        </div>
      </Section>

      <Section title="Authentication">
        <div className="settings-account-grid">
          <MetricCard
            icon={<KeyRound size={15} />}
            label="Credential"
            value={stats.authenticated ? stats.authSession?.keyPrefix ?? 'Signed in' : 'No session'}
            detail={
              stats.authenticated
                ? `Saved ${formatRelativeDate(stats.authSession?.savedAt ?? '')}`
                : 'Login from the startup screen or Models settings'
            }
          />
          <MetricCard
            icon={<Database size={15} />}
            label="chaxiejun.xyz Provider"
            value={stats.latticeProvider ? stats.latticeProvider.name : 'Missing'}
            detail={
              stats.latticeProvider?.enabled
                ? `${stats.latticeProvider.models.length} models available`
                : 'Provider needs setup'
            }
          />
          <MetricCard
            icon={<Cpu size={15} />}
            label="Default model"
            value={stats.resolved?.model.label ?? 'Not configured'}
            detail={stats.resolved?.provider.name ?? 'Choose a model in Models'}
          />
          <MetricCard
            icon={<Gauge size={15} />}
            label="Daily usage"
            value={`${formatTokens(stats.totalTodayTokens)} tokens`}
            detail={`${stats.today.calls} calls · ${formatUSD(stats.today.costUSD)}`}
          />
        </div>
      </Section>

      <Section title="Usage and limits">
        <div className="settings-account-usage">
          <div className="settings-account-progress-head">
            <span>{dailyBudgetLabel(stats.budget.daily)}</span>
            <strong>{Math.round(stats.budgetPct * 100)}%</strong>
          </div>
          <div className="settings-account-progress">
            <span
              className="settings-account-progress-fill"
              style={
                {
                  '--settings-account-progress-width': `${Math.max(2, stats.budgetPct * 100)}%`,
                  '--settings-account-progress-bg': colorForPct(stats.budgetPct),
                } as CSSProperties
              }
            />
          </div>
          <div className="settings-account-detail-grid">
            <DetailRow label="Enabled providers" value={`${stats.enabledProviders} / ${stats.providers.length}`} />
            <DetailRow label="Available models" value={String(stats.totalModels)} />
            <DetailRow label="Today" value={`${stats.today.calls} calls · ${formatUSD(stats.today.costUSD)}`} />
            <DetailRow label="All time" value={`${stats.allTime.calls} calls · ${formatUSD(stats.allTime.costUSD)}`} />
            <DetailRow label="Last call" value={lastCallLabel(stats.lastRecord)} />
          </div>
        </div>
      </Section>
    </div>
  )
}

function MetricCard({
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
    <div className="settings-account-card">
      <div className="settings-account-card-label">
        {icon}
        <span>{label}</span>
      </div>
      <div className="settings-account-card-value" title={value}>{value}</div>
      <div className="settings-account-card-detail" title={detail}>{detail}</div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings-account-detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
