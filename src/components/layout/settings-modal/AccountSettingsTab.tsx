import { ExternalLink, ShieldCheck } from 'lucide-react'
import {
  formatRelativeDate,
  lastCallLabel,
  useAccountStats,
} from '../account-stats'
import { Section } from './primitives'

const CHAXIEJUN_ACCOUNT_URL = 'https://chaxiejun.xyz/admin'

export default function AccountSettingsTab() {
  const stats = useAccountStats()

  const openChaxiejun = () => {
    window.open(CHAXIEJUN_ACCOUNT_URL, '_blank', 'noopener,noreferrer')
  }

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

      <Section title="Details">
        <div className="settings-account-record">
          <DetailRow
            label="Username"
            value={stats.authenticated ? stats.authSession?.username ?? 'Signed in' : 'Not signed in'}
          />
          <DetailRow
            label="Connection"
            value={stats.providerLabel}
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
            label="Last used"
            value={lastCallLabel(stats.lastRecord)}
          />
          <button
            type="button"
            className="account-stats-settings"
            onClick={openChaxiejun}
          >
            <span>Open chaxiejun.xyz</span>
            <ExternalLink size={12} aria-hidden />
          </button>
        </div>
      </Section>
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
