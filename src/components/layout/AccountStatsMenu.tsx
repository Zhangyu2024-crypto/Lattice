import {
  CircleUserRound,
  ExternalLink,
  Gauge,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { useOutsideClickDismiss } from '../../hooks/useOutsideClickDismiss'
import {
  lastCallLabel,
  useAccountStats,
} from './account-stats'

interface Props {
  onOpenSettings: (tab?: 'account' | 'models') => void
}

const POPOVER_WIDTH = 280
const POPOVER_MARGIN = 8

export default function AccountStatsMenu({ onOpenSettings }: Props) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const stats = useAccountStats()

  useEffect(() => {
    if (open) void stats.refreshSession()
  }, [open])

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

  const buttonTitle = stats.authenticated
    ? `${stats.authSession?.username ?? 'User'} account`
    : 'Account'
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
          className={`activity-account-dot activity-account-dot--${stats.providerTone}`}
          aria-hidden
        />
      </button>

      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Account"
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
              {stats.authenticated
                ? stats.authSession?.username.slice(0, 1).toUpperCase()
                : '?'}
            </div>
            <div className="account-stats-title-wrap">
              <div className="account-stats-name">{stats.accountName}</div>
              <div className="account-stats-subtitle">{stats.accountSubtitle}</div>
            </div>
            <button
              type="button"
              className="account-stats-refresh"
              onClick={() => void stats.refreshSession()}
              title="Refresh account"
              aria-label="Refresh account"
            >
              <RefreshCw size={13} aria-hidden />
            </button>
          </div>

          <div className={`account-stats-state account-stats-state--${stats.providerTone}`}>
            <ShieldCheck size={13} aria-hidden />
            <span>{stats.providerLabel}</span>
          </div>

          <div className="account-stats-summary">
            <InfoRow
              icon={<ShieldCheck size={13} />}
              label="Session"
              value={stats.sessionLabel}
              detail={stats.sessionDetail}
            />
            <InfoRow
              icon={<Sparkles size={13} />}
              label="Service"
              value={stats.serviceLabel}
              detail={stats.serviceDetail}
            />
            <InfoRow
              icon={<Gauge size={13} />}
              label="Today"
              value={stats.todayUsageLabel}
              detail={stats.todayUsageDetail}
            />
          </div>

          <div className="account-stats-footnote">
            Last call: {lastCallLabel(stats.lastRecord)}
          </div>

          <button
            type="button"
            className="account-stats-settings"
            onClick={() => {
              setOpen(false)
              onOpenSettings('account')
            }}
          >
            <span>Manage account</span>
            <ExternalLink size={12} aria-hidden />
          </button>
        </div>
      )}
    </>
  )
}

function InfoRow({
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
    <div className="account-stats-info-row">
      <div className="account-stats-info-icon" aria-hidden>{icon}</div>
      <div className="account-stats-info-main">
        <div className="account-stats-info-head">
          <span>{label}</span>
          <strong title={value}>{value}</strong>
        </div>
        <div className="account-stats-info-detail" title={detail}>{detail}</div>
      </div>
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
