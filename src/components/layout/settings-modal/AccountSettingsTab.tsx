import {
  Gauge,
  KeyRound,
  MessageSquare,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import {
  colorForPct,
  dailyBudgetLabel,
  formatRelativeDate,
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
            <div className="settings-account-name">{stats.accountName}</div>
            <div className="settings-account-subtitle">{stats.accountSubtitle}</div>
          </div>
          <div className={`settings-account-status settings-account-status--${stats.providerTone}`}>
            <ShieldCheck size={14} aria-hidden />
            <span>{stats.providerLabel}</span>
          </div>
        </div>
      </Section>

      <Section title="Identity and model">
        <div className="settings-account-grid">
          <MetricCard
            icon={<KeyRound size={15} />}
            label="Credential"
            value={stats.credentialLabel}
            detail={stats.credentialDetail}
          />
          <MetricCard
            icon={<ShieldCheck size={15} />}
            label="Account provider"
            value={stats.providerLabel}
            detail={stats.providerDetail}
          />
          <MetricCard
            icon={<Sparkles size={15} />}
            label="Default model"
            value={stats.modelLabel}
            detail={stats.modelDetail}
          />
          <MetricCard
            icon={<Gauge size={15} />}
            label="Daily usage"
            value={stats.todayUsageLabel}
            detail={stats.todayUsageDetail}
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
            <DetailRow label="Today" value={stats.todayUsageDetail} />
            <DetailRow label="All time" value={stats.allTimeUsageDetail} />
            <DetailRow label="Total tokens" value={stats.allTimeUsageLabel} />
            <DetailRow label="Last call" value={lastCallLabel(stats.lastRecord)} />
          </div>
        </div>
      </Section>

      <Section title="Account record">
        <div className="settings-account-record">
          <DetailRow
            label="Username"
            value={stats.authenticated ? stats.authSession?.username ?? 'Signed in' : 'Not signed in'}
          />
          <DetailRow
            label="Credential"
            value={stats.credentialLabel}
          />
          <DetailRow
            label="Saved"
            value={
              stats.authenticated
                ? formatRelativeDate(stats.authSession?.savedAt ?? '')
                : 'No local credential'
            }
          />
          <DetailRow
            label="Last request"
            value={lastCallLabel(stats.lastRecord)}
          />
          <div className="settings-account-record-note">
            <MessageSquare size={14} aria-hidden />
            <span>Usage is tracked locally from Lattice model calls made in this workspace.</span>
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
