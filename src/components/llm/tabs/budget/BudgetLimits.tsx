import { fmtInt, fmtUSD } from '../../llm-config-helpers'
import type {
  BudgetConfig,
  BudgetMode,
  UsageAggregate,
} from '../../../../types/llm'
import { Field, LimitPair, NumberInput, ProgressBar, Section } from './shared'
import { WARN_PCT_OPTIONS } from './types'

interface BudgetLimitsProps {
  budget: BudgetConfig
  updateBudget: (patch: Partial<BudgetConfig>) => void
  today: UsageAggregate
}

// Daily / monthly / per-request / mode / today-progress block. Kept as a
// single component because every sub-section mutates the same `budget`
// object and sharing the store-derived closures here avoids prop-drilling
// five separate patch callbacks.
export default function BudgetLimits({
  budget,
  updateBudget,
  today,
}: BudgetLimitsProps) {
  return (
    <>
      <Section title="Daily limits">
        <LimitPair
          tokenValue={budget.daily.tokenLimit}
          tokenOnChange={(v) =>
            updateBudget({ daily: { ...budget.daily, tokenLimit: v } })
          }
          costValue={budget.daily.costLimitUSD}
          costOnChange={(v) =>
            updateBudget({ daily: { ...budget.daily, costLimitUSD: v } })
          }
        />
        <Field label="Warn at">
          <select
            value={budget.warnAtPct}
            onChange={(e) => updateBudget({ warnAtPct: Number(e.target.value) })}
            className="llm-input llm-budget-input--warn"
          >
            {WARN_PCT_OPTIONS.map((pct) => (
              <option key={pct} value={pct}>
                {Math.round(pct * 100)}%
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title="Monthly limits">
        <LimitPair
          tokenValue={budget.monthly.tokenLimit}
          tokenOnChange={(v) =>
            updateBudget({ monthly: { ...budget.monthly, tokenLimit: v } })
          }
          costValue={budget.monthly.costLimitUSD}
          costOnChange={(v) =>
            updateBudget({ monthly: { ...budget.monthly, costLimitUSD: v } })
          }
        />
      </Section>

      <Section title="Per-request limits">
        <Field label="Max input tokens">
          <NumberInput
            min={128}
            step={128}
            value={budget.perRequest.maxInputTokens}
            onChange={(n) =>
              updateBudget({
                perRequest: { ...budget.perRequest, maxInputTokens: n },
              })
            }
          />
        </Field>
        <Field label="Max output tokens">
          <NumberInput
            min={128}
            step={128}
            value={budget.perRequest.maxOutputTokens}
            onChange={(n) =>
              updateBudget({
                perRequest: { ...budget.perRequest, maxOutputTokens: n },
              })
            }
          />
        </Field>
      </Section>

      <Section title="Mode">
        <div className="llm-budget-mode-row">
          {(
            [
              { key: 'warn', label: 'Warn but allow requests' },
              { key: 'block', label: 'Hard stop on limit' },
            ] as Array<{ key: BudgetMode; label: string }>
          ).map((opt) => (
            <label key={opt.key} className="llm-budget-radio-row">
              <input
                type="radio"
                name="budget-mode"
                checked={budget.mode === opt.key}
                onChange={() => updateBudget({ mode: opt.key })}
                className="llm-cursor-pointer"
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      </Section>

      <Section title="Current progress today">
        <ProgressBar
          label="Tokens used"
          current={today.inputTokens + today.outputTokens}
          limit={budget.daily.tokenLimit}
          formatter={fmtInt}
        />
        <ProgressBar
          label="Cost used"
          current={today.costUSD}
          limit={budget.daily.costLimitUSD}
          formatter={fmtUSD}
        />
      </Section>
    </>
  )
}
