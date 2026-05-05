import {
  Gauge,
  MessageSquare,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import type { ReactNode } from 'react'
import {
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

      <Section title="Connection">
        <div className="settings-account-grid">
          <MetricCard
            icon={<ShieldCheck size={15} />}
            label="Desktop session"
            value={stats.sessionLabel}
            detail={stats.sessionDetail}
          />
          <MetricCard
            icon={<ShieldCheck size={15} />}
            label="Account provider"
            value={stats.providerLabel}
            detail={stats.providerDetail}
          />
          <MetricCard
            icon={<Sparkles size={15} />}
            label="Service connection"
            value={stats.serviceLabel}
            detail={stats.serviceDetail}
          />
          <MetricCard
            icon={<Gauge size={15} />}
            label="Daily usage"
            value={stats.todayUsageLabel}
            detail={stats.todayUsageDetail}
          />
        </div>
      </Section>

      <Section title="Account record">
        <div className="settings-account-record">
          <DetailRow
            label="Username"
            value={stats.authenticated ? stats.authSession?.username ?? 'Signed in' : 'Not signed in'}
          />
          <DetailRow
            label="Desktop session"
            value={stats.sessionLabel}
          />
          <DetailRow
            label="Saved"
            value={
              stats.authenticated
                ? formatRelativeDate(stats.authSession?.savedAt ?? '')
                : 'No local sign-in'
            }
          />
          <DetailRow
            label="Last request"
            value={lastCallLabel(stats.lastRecord)}
          />
          <div className="settings-account-record-note">
            <MessageSquare size={14} aria-hidden />
            <span>Usage is tracked locally from Lattice workspace calls made here.</span>
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
