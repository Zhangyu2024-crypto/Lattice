import {
  CircleUserRound,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useOutsideClickDismiss } from '../../hooks/useOutsideClickDismiss'
import {
  hostLabel,
  useAccountStats,
} from './account-stats'

interface Props {
  onOpenSettings: (tab?: 'account' | 'models') => void
}

const POPOVER_WIDTH = 260
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
          className="account-stats-popover account-stats-popover--compact"
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
              <div className="account-stats-name">
                {stats.authenticated
                  ? stats.authSession?.username
                  : stats.checking
                    ? 'Checking account'
                    : 'Not signed in'}
              </div>
              <div className="account-stats-subtitle">
                {stats.authenticated
                  ? hostLabel(stats.authSession?.baseUrl ?? '')
                  : stats.sessionError ?? 'chaxiejun.xyz desktop session'}
              </div>
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
            <span>{stats.providerStatus}</span>
          </div>

          <div className="account-stats-compact-lines">
            <div className="account-stats-row">
              <span>Default model</span>
              <strong>{stats.resolved?.model.label ?? 'Not configured'}</strong>
            </div>
            <div className="account-stats-row">
              <span>Provider</span>
              <strong>
                {stats.latticeProvider
                  ? `${stats.latticeProvider.models.length} models`
                  : 'Missing'}
              </strong>
            </div>
          </div>

          <button
            type="button"
            className="account-stats-settings"
            onClick={() => {
              setOpen(false)
              onOpenSettings('account')
            }}
          >
            <span>Account details</span>
            <ExternalLink size={12} aria-hidden />
          </button>
          <button
            type="button"
            className="account-stats-settings account-stats-settings--secondary"
            onClick={() => {
              setOpen(false)
              onOpenSettings('models')
            }}
          >
            <span>Model settings</span>
            <Sparkles size={12} aria-hidden />
          </button>
        </div>
      )}
    </>
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
