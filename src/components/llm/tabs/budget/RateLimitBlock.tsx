import type { RateLimitConfig } from '../../../../types/llm'
import { Field, Section } from './shared'

interface RateLimitBlockProps {
  rateLimit: RateLimitConfig
  updateRateLimit: (patch: Partial<RateLimitConfig>) => void
}

export default function RateLimitBlock({
  rateLimit,
  updateRateLimit,
}: RateLimitBlockProps) {
  const backoff = rateLimit.exponentialBackoff
  const backoffOn = backoff.enabled
  const patchBackoff = (p: Partial<RateLimitConfig['exponentialBackoff']>) =>
    updateRateLimit({ exponentialBackoff: { ...backoff, ...p } })

  return (
    <>
      <Section title="Throughput">
        <Field label="Max calls / minute">
          <input
            type="number"
            min={1}
            max={600}
            step={1}
            value={rateLimit.maxCallsPerMinute}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10)
              if (Number.isFinite(n)) {
                updateRateLimit({
                  maxCallsPerMinute: Math.max(1, Math.min(600, n)),
                })
              }
            }}
            className="llm-input llm-budget-input--num"
          />
        </Field>
      </Section>

      <Section title="Retries">
        <Field label="Retry on 429">
          <label className="llm-budget-radio-row">
            <input
              type="checkbox"
              checked={rateLimit.retryOn429}
              onChange={(e) =>
                updateRateLimit({ retryOn429: e.target.checked })
              }
              className="llm-cursor-pointer"
            />
            <span>Automatically retry rate-limited responses</span>
          </label>
        </Field>
        <Field label="Exponential backoff">
          <label className="llm-budget-radio-row">
            <input
              type="checkbox"
              checked={backoffOn}
              onChange={(e) => patchBackoff({ enabled: e.target.checked })}
              className="llm-cursor-pointer"
            />
            <span>Space out retries</span>
          </label>
        </Field>
        <Field label="Base backoff (ms)">
          <input
            type="number"
            min={50}
            step={50}
            disabled={!backoffOn}
            value={backoff.baseMs}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10)
              if (Number.isFinite(n)) patchBackoff({ baseMs: Math.max(50, n) })
            }}
            className={`llm-input llm-budget-input--num${backoffOn ? '' : ' llm-input--dim'}`}
          />
        </Field>
        <Field label="Max backoff (ms)">
          <input
            type="number"
            min={backoff.baseMs}
            step={100}
            disabled={!backoffOn}
            value={backoff.maxMs}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10)
              if (Number.isFinite(n)) patchBackoff({ maxMs: Math.max(100, n) })
            }}
            className={`llm-input llm-budget-input--num${backoffOn ? '' : ' llm-input--dim'}`}
          />
        </Field>
      </Section>
    </>
  )
}
