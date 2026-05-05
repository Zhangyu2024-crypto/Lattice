import { useRef, useState } from 'react'
import {
  AlertTriangle,
  Cpu,
  Download,
  Gauge,
  ScrollText,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { useAppStore } from '../../stores/app-store'
import { useLogStore } from '../../stores/log-store'
import {
  selectActiveSession,
  useRuntimeStore,
} from '../../stores/runtime-store'
import { useResolvedModel } from '../../stores/llm-config-store'
import { usePrefsStore } from '../../stores/prefs-store'
import {
  PERMISSION_MODE_DESCRIPTION,
  PERMISSION_MODE_LABEL,
  type PermissionMode,
} from '../../types/permission-mode'
import StatusChip from './StatusChip'
import UsagePopover from './UsagePopover'
import { publicModelLabel } from '../../lib/model-display'
import type { TokenWarningLevel } from '../../lib/context-window'

interface UsageSnapshot {
  tokens: number
  costUSD: number
  pct: number
  warn: boolean
}

export interface ContextSnapshot {
  /** Whole-percent used relative to the usable window (post-buffer). */
  percentUsed: number
  level: TokenWarningLevel
  /** Input tokens the provider reported for the last call on this session.
   *  Serves as a proxy for "current context size" because each call resends
   *  the full history. */
  inputTokens: number
  /** Usable window after the autocompact buffer is subtracted. */
  threshold: number
}

interface Props {
  onExportSession: () => void
  onOpenLLMConfig: () => void
  usage?: UsageSnapshot | null
  context?: ContextSnapshot | null
}

export default function StatusBar({
  onExportSession,
  onOpenLLMConfig,
  usage,
  context,
}: Props) {
  const backend = useAppStore((s) => s.backend)
  const isConnected = useAppStore((s) => s.isConnected)
  const model = useAppStore((s) => s.model)
  const session = useRuntimeStore(selectActiveSession)
  const resolved = useResolvedModel('agent')
  const permissionMode = usePrefsStore((s) => s.permissionMode)

  const displayModel = publicModelLabel(resolved, model || 'no model')

  const modelChipRef = useRef<HTMLDivElement | null>(null)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const toggleUsage = () => setPopoverOpen((v) => !v)

  const logOpen = useLogStore((s) => s.open)
  const logUnread = useLogStore((s) => s.unreadCount)
  const toggleLog = useLogStore((s) => s.toggle)

  const connectionIcon = isConnected ? <Wifi size={14} /> : <WifiOff size={14} />
  const connectionLabel = isConnected
    ? 'Legacy bridge live'
    : backend.ready
      ? 'Legacy bridge ready'
      : 'Local mode'
  const connectionTitle = isConnected
    ? `Optional legacy bridge WebSocket connected on port ${backend.port}`
    : backend.ready
      ? 'Optional legacy bridge process is ready, but the WebSocket is not connected. Local Electron tools still work.'
      : 'Running in local mode. Local Electron tools, local agent tools, and configured LLM providers can still work.'

  return (
    <div className="status-bar">
      {session && (
        <StatusChip title="Active chat">
          {session.title}
        </StatusChip>
      )}

      <div className="status-spacer" />

      <StatusChip icon={connectionIcon} title={connectionTitle}>
        {connectionLabel}
      </StatusChip>

      <StatusChip
        ref={modelChipRef}
        icon={<Cpu size={14} />}
        title="LLM usage + model (click for details)"
        tone={usage?.warn ? 'warn' : 'default'}
        onClick={toggleUsage}
        ariaHasPopup="dialog"
        ariaExpanded={popoverOpen}
      >
        {displayModel}
        {usage && (
          <>
            {' · '}
            {formatTokens(usage.tokens)}
            {usage.costUSD > 0 && ` · $${usage.costUSD.toFixed(2)}`}
            {usage.warn && <AlertTriangle size={12} />}
          </>
        )}
      </StatusChip>

      {permissionMode !== 'normal' && (
        <StatusChip
          icon={permissionModeIcon(permissionMode)}
          title={`${PERMISSION_MODE_LABEL[permissionMode]} mode — ${PERMISSION_MODE_DESCRIPTION[permissionMode]}`}
          tone={permissionMode === 'yolo' ? 'warn' : 'default'}
        >
          {PERMISSION_MODE_LABEL[permissionMode]}
        </StatusChip>
      )}

      {context && context.threshold > 0 && (
        <StatusChip
          icon={<Gauge size={14} />}
          title={contextChipTitle(context)}
          tone={
            context.level === 'critical'
              ? 'critical'
              : context.level === 'warn'
                ? 'warn'
                : 'default'
          }
        >
          context {context.percentUsed}%
        </StatusChip>
      )}

      <StatusChip
        icon={
          <span className="log-chip-icon-wrap">
            <ScrollText size={14} />
            {logUnread > 0 && (
              <span className="log-chip-badge">
                {logUnread > 99 ? '99+' : logUnread}
              </span>
            )}
          </span>
        }
        title={logOpen ? 'Close log console' : 'Open log console'}
        tone={logUnread > 0 ? 'warn' : 'default'}
        onClick={toggleLog}
      >
        Log
      </StatusChip>

      <StatusChip
        icon={<Download size={14} />}
        title="Export session"
        onClick={onExportSession}
      >
        Export
      </StatusChip>

      {popoverOpen && (
        <UsagePopover
          anchorEl={modelChipRef.current}
          onClose={() => setPopoverOpen(false)}
          onOpenSettings={() => {
            setPopoverOpen(false)
            onOpenLLMConfig()
          }}
        />
      )}
    </div>
  )
}

function permissionModeIcon(mode: PermissionMode) {
  switch (mode) {
    case 'auto-accept':
      return <ShieldCheck size={14} />
    case 'read-only':
      return <ShieldX size={14} />
    case 'yolo':
      return <ShieldAlert size={14} />
    case 'normal':
    default:
      return <Shield size={14} />
  }
}

function formatTokens(n: number): string {
  if (n < 1000) return `${n}`
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

function contextChipTitle(ctx: ContextSnapshot): string {
  const tokens = formatTokens(ctx.inputTokens)
  const threshold = formatTokens(ctx.threshold)
  const tail =
    ctx.level === 'critical'
      ? ' — near the context limit, consider starting a new chat'
      : ctx.level === 'warn'
        ? ' — context usage is getting high'
        : ''
  return `Context window (last turn): ${tokens} of ${threshold}${tail}`
}
