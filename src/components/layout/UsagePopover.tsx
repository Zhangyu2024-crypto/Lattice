import { useEffect, useMemo, useRef } from 'react'
import { ExternalLink, Gauge, Settings } from 'lucide-react'
import { useLLMConfigStore, useResolvedModel } from '../../stores/llm-config-store'
import { useUsageStore } from '../../stores/usage-store'
import type { UsageAggregate } from '../../types/llm'
import { TYPO } from '../../lib/typography-inline'
import { useOutsideClickDismiss } from '../../hooks/useOutsideClickDismiss'
import {
  publicModelLabel,
  publicProviderModelLabel,
} from '../../lib/model-display'

interface Props {
  anchorEl: HTMLElement | null
  onClose: () => void
  onOpenSettings: () => void
}

const EMPTY_AGG: UsageAggregate = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUSD: 0,
}

// Compact popover anchored to the StatusBar model chip. Surfaces the day's
// usage and a provider-switcher so users don't need to open the full LLM
// config modal for the common case of "what's my model + spend right now".
export default function UsagePopover({
  anchorEl,
  onClose,
  onOpenSettings,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const resolved = useResolvedModel('agent')
  const providers = useLLMConfigStore((s) => s.providers)
  const agentCfg = useLLMConfigStore((s) => s.agent)
  const updateAgentConfig = useLLMConfigStore((s) => s.updateAgentConfig)
  const budget = useLLMConfigStore((s) => s.budget)
  const getTodayTotals = useUsageStore((s) => s.getTodayTotals)
  const records = useUsageStore((s) => s.records)

  const today: UsageAggregate = useMemo(() => {
    try {
      return getTodayTotals() ?? EMPTY_AGG
    } catch {
      return EMPTY_AGG
    }
    // records invalidation is intentional: getTodayTotals is stable but reads
    // live state, so we recompute whenever a new record is appended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getTodayTotals, records])

  const currentCfg = agentCfg
  const updateCfg = updateAgentConfig

  const totalTokens = today.inputTokens + today.outputTokens
  const tokenPct = budget.daily.tokenLimit
    ? Math.min(1, totalTokens / budget.daily.tokenLimit)
    : 0
  const costPct = budget.daily.costLimitUSD
    ? Math.min(1, today.costUSD / budget.daily.costLimitUSD)
    : 0
  const budgetPct = Math.max(tokenPct, costPct)

  // Anchor trigger is a detached sibling (StatusBar chip) — exempt
  // clicks on it from the dismissal so its own onClick toggle isn't
  // trampled by a fresh close/reopen cycle.
  const anchorRef = useMemo<React.RefObject<HTMLElement | null>>(
    () => ({ current: anchorEl }),
    [anchorEl],
  )
  useOutsideClickDismiss(rootRef, true, onClose, anchorRef)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const position = useMemo(() => anchorPosition(anchorEl), [anchorEl])

  const modelOptions = useMemo(() => {
    const out: Array<{
      key: string
      providerId: string
      modelId: string
      label: string
      disabled: boolean
    }> = []
    for (const provider of providers) {
      for (const model of provider.models) {
        out.push({
          key: `${provider.id}::${model.id}`,
          providerId: provider.id,
          modelId: model.id,
          label: publicProviderModelLabel(provider, model),
          disabled: !provider.enabled,
        })
      }
    }
    return out
  }, [providers])

  const selectedKey = currentCfg.providerId && currentCfg.modelId
    ? `${currentCfg.providerId}::${currentCfg.modelId}`
    : ''

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="LLM usage and model switcher"
      className="usage-popover"
      style={
        {
          '--usage-popover-left': `${position.left}px`,
          '--usage-popover-bottom': `${position.bottom}px`,
        } as React.CSSProperties
      }
    >
      <div style={S.header}>
        <Gauge size={13} className="usage-popover-gauge" />
        <span style={S.headerTitle}>LLM usage</span>
      </div>

      <section style={S.section}>
        <div style={S.sectionLabel}>AI service</div>
        <div style={S.modelLine}>
          {publicModelLabel(resolved, 'Not configured')}
        </div>
        <select
          value={selectedKey}
          onChange={(e) => {
            const [providerId, modelId] = e.target.value.split('::')
            if (providerId && modelId) updateCfg({ providerId, modelId })
          }}
          style={S.select}
        >
          {selectedKey === '' && (
            <option value="" disabled>
              Select a model…
            </option>
          )}
          {modelOptions.map((opt) => (
            <option key={opt.key} value={opt.key} disabled={opt.disabled}>
              {opt.label}
              {opt.disabled ? ' (disabled)' : ''}
            </option>
          ))}
        </select>
      </section>

      <section style={S.section}>
        <div style={S.sectionLabel}>Today</div>
        <div style={S.metricRow}>
          <span style={S.metricKey}>Tokens</span>
          <span style={S.metricVal}>{formatTokens(totalTokens)}</span>
        </div>
        <div style={S.metricRow}>
          <span style={S.metricKey}>Cost</span>
          <span style={S.metricVal}>{formatUSD(today.costUSD)}</span>
        </div>
        <div style={S.metricRow}>
          <span style={S.metricKey}>Calls</span>
          <span style={S.metricVal}>{today.calls}</span>
        </div>
        <div style={S.progressTrack}>
          <div
            className="usage-popover-progress-fill"
            style={
              {
                '--usage-popover-progress-width': `${Math.max(
                  2,
                  budgetPct * 100,
                )}%`,
                '--usage-popover-progress-bg': colorForPct(budgetPct),
              } as React.CSSProperties
            }
          />
        </div>
        <div style={S.progressCaption}>
          {budget.daily.tokenLimit || budget.daily.costLimitUSD
            ? `${Math.round(budgetPct * 100)}% of daily budget`
            : 'No daily budget set'}
        </div>
      </section>

      <button type="button" style={S.footerBtn} onClick={onOpenSettings}>
        <Settings size={12} />
        <span className="usage-popover-footer-label">Open settings</span>
        <ExternalLink size={11} className="usage-popover-footer-hint" />
      </button>
    </div>
  )
}

interface Position {
  left: number
  bottom: number
}

const POPOVER_WIDTH = 300
const POPOVER_MARGIN = 8

function anchorPosition(anchorEl: HTMLElement | null): Position {
  if (!anchorEl || typeof window === 'undefined') {
    return { left: 16, bottom: 32 }
  }
  const rect = anchorEl.getBoundingClientRect()
  const viewportW = window.innerWidth
  const viewportH = window.innerHeight
  // Anchor above the chip: left-align to the chip, but clamp so the popover
  // stays inside the viewport on narrow windows.
  const desiredLeft = Math.min(
    Math.max(POPOVER_MARGIN, rect.left),
    viewportW - POPOVER_WIDTH - POPOVER_MARGIN,
  )
  const bottom = Math.max(POPOVER_MARGIN, viewportH - rect.top + 6)
  return { left: desiredLeft, bottom }
}

function formatTokens(n: number): string {
  if (n < 1000) return `${n}`
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

function formatUSD(n: number): string {
  if (!Number.isFinite(n)) return '$0.00'
  if (Math.abs(n) < 0.01 && n !== 0) return '<$0.01'
  return `$${n.toFixed(2)}`
}

function colorForPct(pct: number): string {
  if (pct < 0.5) return 'var(--color-green)'
  if (pct < 0.8) return 'var(--color-accent)'
  if (pct < 0.95) return 'var(--color-yellow)'
  return 'var(--color-red)'
}

const S: Record<string, React.CSSProperties> = {
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 8,
    borderBottom: '1px solid var(--color-border)',
  },
  headerTitle: {
    fontSize: TYPO.sm,
    fontWeight: 600,
    color: 'var(--color-text-primary)',
    flex: 1,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  sectionLabel: {
    fontSize: TYPO.xxs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: 'var(--color-text-muted)',
  },
  modelLine: {
    fontSize: TYPO.sm,
    color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-mono)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  select: {
    background: 'var(--color-bg-input)',
    border: '1px solid var(--color-border)',
    borderRadius: 3,
    padding: '4px 6px',
    color: 'var(--color-text-primary)',
    fontSize: TYPO.xs,
    outline: 'none',
    fontFamily: 'inherit',
    width: '100%',
  },
  metricRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    fontSize: TYPO.xs,
  },
  metricKey: { color: 'var(--color-text-secondary)' },
  metricVal: {
    color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-mono)',
    fontWeight: 600,
  },
  progressTrack: {
    height: 6,
    width: '100%',
    background: 'var(--color-border)',
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 2,
  },
  progressCaption: {
    fontSize: TYPO.xxs,
    color: 'var(--color-text-muted)',
  },
  footerBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    background: 'transparent',
    border: '1px solid var(--color-border)',
    borderRadius: 4,
    color: 'var(--color-text-primary)',
    padding: '6px 10px',
    fontSize: TYPO.sm,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
}
