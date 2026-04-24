import { useMemo } from 'react'
// TODO(integration): llm-config-store + usage-store are built in parallel.
import { useLLMConfigStore } from '../../../stores/llm-config-store'
import { useUsageStore } from '../../../stores/usage-store'
import type { UsageAggregate } from '../../../types/llm'
import BudgetLimits from './budget/BudgetLimits'
import RateLimitBlock from './budget/RateLimitBlock'
import { EMPTY_AGG } from './budget/types'

export default function BudgetTab() {
  const budget = useLLMConfigStore((s) => s.budget)
  const updateBudget = useLLMConfigStore((s) => s.updateBudget)
  const rateLimit = useLLMConfigStore((s) => s.rateLimit)
  const updateRateLimit = useLLMConfigStore((s) => s.updateRateLimit)
  const getToday = useUsageStore((s) => s.getTodayTotals)

  const today: UsageAggregate = useMemo(() => {
    try {
      return getToday() ?? EMPTY_AGG
    } catch {
      return EMPTY_AGG
    }
  }, [getToday])

  return (
    <div>
      <div className="llm-budget-heading">Budget</div>
      <div className="llm-info-banner">
        Budgets are enforced client-side. Warn mode surfaces a toast when you
        cross the warning threshold; Block mode prevents new requests once the
        limit is hit.
      </div>

      <BudgetLimits
        budget={budget}
        updateBudget={updateBudget}
        today={today}
      />

      <div className="llm-budget-divider" role="separator" />
      <div className="llm-budget-heading">Rate limits</div>
      <div className="llm-info-banner">
        Client-side throttling guards against runaway loops and provider 429s.
        Server-side limits still apply on top.
      </div>

      <RateLimitBlock
        rateLimit={rateLimit}
        updateRateLimit={updateRateLimit}
      />
    </div>
  )
}
