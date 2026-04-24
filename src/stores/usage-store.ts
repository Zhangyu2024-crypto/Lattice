import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type {
  UsageAggregate,
  UsageDailyBucket,
  UsageRecord,
} from '../types/llm'

// Persistence caps. `records` is the authoritative log and caps at 1000 in
// memory; we only persist the most recent 500 to stay well under the
// ~5 MB localStorage quota (a fat record is ~0.4 KB so 500 ≈ 200 KB of
// stringified JSON, leaving headroom for the session store).
const RECORDS_MEMORY_CAP = 1000
const RECORDS_PERSIST_CAP = 500
const DAILY_BUCKETS_CAP = 90

const EMPTY_AGGREGATE: UsageAggregate = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUSD: 0,
}

// Date helper — we intentionally use UTC-ish `toISOString().slice(0, 10)` to
// match the design spec; calling code that wants local-day buckets should
// translate before persisting. For the MVP the small skew is acceptable.
const dateKey = (ts: number): string => new Date(ts).toISOString().slice(0, 10)

const genUsageId = (): string =>
  `usg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`

const csvEscape = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  const s = String(value)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

// Add a UsageRecord into an existing daily-buckets array, returning a new
// array. If today's bucket exists, its counters are incremented; otherwise
// a new bucket is prepended. Returned array is sorted by date descending so
// "recent first" reads are O(1).
const incrementDailyBuckets = (
  prev: UsageDailyBucket[],
  record: UsageRecord,
): UsageDailyBucket[] => {
  const key = dateKey(record.timestamp)
  const idx = prev.findIndex((b) => b.date === key)
  let next: UsageDailyBucket[]
  if (idx >= 0) {
    const bucket = prev[idx]
    const updated: UsageDailyBucket = {
      date: bucket.date,
      calls: bucket.calls + 1,
      inputTokens: bucket.inputTokens + record.inputTokens,
      outputTokens: bucket.outputTokens + record.outputTokens,
      costUSD: bucket.costUSD + record.costUSD,
    }
    next = prev.map((b, i) => (i === idx ? updated : b))
  } else {
    next = [
      {
        date: key,
        calls: 1,
        inputTokens: record.inputTokens,
        outputTokens: record.outputTokens,
        costUSD: record.costUSD,
      },
      ...prev,
    ]
  }
  // Sort by date descending then trim. Sort is cheap (<= 90 entries).
  next.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  if (next.length > DAILY_BUCKETS_CAP) next.length = DAILY_BUCKETS_CAP
  return next
}

const incrementSessionAgg = (
  prev: Record<string, UsageAggregate>,
  record: UsageRecord,
): Record<string, UsageAggregate> => {
  if (!record.sessionId) return prev
  const current = prev[record.sessionId] ?? EMPTY_AGGREGATE
  return {
    ...prev,
    [record.sessionId]: {
      calls: current.calls + 1,
      inputTokens: current.inputTokens + record.inputTokens,
      outputTokens: current.outputTokens + record.outputTokens,
      costUSD: current.costUSD + record.costUSD,
    },
  }
}

interface RecordCallInput
  extends Omit<UsageRecord, 'id' | 'timestamp'>,
    Partial<Pick<UsageRecord, 'timestamp'>> {}

interface UsageState {
  records: UsageRecord[]
  dailyBuckets: UsageDailyBucket[]
  sessionAggregates: Record<string, UsageAggregate>

  recordCall: (input: RecordCallInput) => string
  clearHistory: () => void
  clearSession: (sessionId: string) => void

  // Read-only derivations. Called from components/effects — each returns a
  // freshly computed object, so callers should memoize on the underlying
  // slices (records / dailyBuckets) rather than the return value.
  getTodayTotals: () => UsageAggregate
  getSessionTotals: (sessionId: string | null) => UsageAggregate
  getAllTimeTotals: () => UsageAggregate
  getLast7Days: () => UsageDailyBucket[]

  exportCSV: () => string
}

export const useUsageStore = create<UsageState>()(
  persist(
    (set, get) => ({
      records: [],
      dailyBuckets: [],
      sessionAggregates: {},

      recordCall: (input) => {
        const id = genUsageId()
        const timestamp = input.timestamp ?? Date.now()
        const record: UsageRecord = { ...input, id, timestamp }
        set((s) => {
          // Cap in-memory records. Drop oldest entries (index 0 ... n-cap-1)
          // using slice which creates a new array, preserving immutability.
          const combined = [...s.records, record]
          const trimmed =
            combined.length > RECORDS_MEMORY_CAP
              ? combined.slice(combined.length - RECORDS_MEMORY_CAP)
              : combined
          return {
            records: trimmed,
            dailyBuckets: incrementDailyBuckets(s.dailyBuckets, record),
            sessionAggregates: incrementSessionAgg(s.sessionAggregates, record),
          }
        })
        return id
      },

      clearHistory: () => {
        set({ records: [], dailyBuckets: [], sessionAggregates: {} })
      },

      clearSession: (sessionId) => {
        set((s) => {
          const hadAgg = sessionId in s.sessionAggregates
          const filteredRecords = s.records.filter(
            (r) => r.sessionId !== sessionId,
          )
          const recordsChanged = filteredRecords.length !== s.records.length
          if (!hadAgg && !recordsChanged) return {}
          let nextSessionAggregates = s.sessionAggregates
          if (hadAgg) {
            const { [sessionId]: _removed, ...rest } = s.sessionAggregates
            nextSessionAggregates = rest
          }
          return {
            records: recordsChanged ? filteredRecords : s.records,
            sessionAggregates: nextSessionAggregates,
          }
        })
      },

      getTodayTotals: () => {
        const today = dateKey(Date.now())
        const bucket = get().dailyBuckets.find((b) => b.date === today)
        if (!bucket) return { ...EMPTY_AGGREGATE }
        return {
          calls: bucket.calls,
          inputTokens: bucket.inputTokens,
          outputTokens: bucket.outputTokens,
          costUSD: bucket.costUSD,
        }
      },

      getSessionTotals: (sessionId) => {
        if (!sessionId) return { ...EMPTY_AGGREGATE }
        return { ...(get().sessionAggregates[sessionId] ?? EMPTY_AGGREGATE) }
      },

      getAllTimeTotals: () => {
        const { dailyBuckets } = get()
        return dailyBuckets.reduce<UsageAggregate>(
          (acc, b) => ({
            calls: acc.calls + b.calls,
            inputTokens: acc.inputTokens + b.inputTokens,
            outputTokens: acc.outputTokens + b.outputTokens,
            costUSD: acc.costUSD + b.costUSD,
          }),
          { ...EMPTY_AGGREGATE },
        )
      },

      getLast7Days: () => {
        const buckets = get().dailyBuckets
        const byDate = new Map(buckets.map((b) => [b.date, b]))
        const out: UsageDailyBucket[] = []
        const now = new Date()
        // Anchor to UTC midnight to match dateKey semantics.
        const anchor = new Date(
          Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate(),
            0,
            0,
            0,
            0,
          ),
        )
        for (let i = 6; i >= 0; i--) {
          const d = new Date(anchor)
          d.setUTCDate(anchor.getUTCDate() - i)
          const key = d.toISOString().slice(0, 10)
          const existing = byDate.get(key)
          out.push(
            existing
              ? { ...existing }
              : {
                  date: key,
                  calls: 0,
                  inputTokens: 0,
                  outputTokens: 0,
                  costUSD: 0,
                },
          )
        }
        return out
      },

      exportCSV: () => {
        const header = [
          'id',
          'timestamp_iso',
          'provider',
          'model',
          'mode',
          'session_id',
          'input_tokens',
          'output_tokens',
          'cache_read',
          'cache_create',
          'duration_ms',
          'cost_usd',
          'success',
          'error',
          'snippet',
        ]
        const rows = get().records.map((r) =>
          [
            r.id,
            new Date(r.timestamp).toISOString(),
            r.providerId,
            r.modelId,
            r.mode,
            r.sessionId ?? '',
            r.inputTokens,
            r.outputTokens,
            r.cacheReadTokens,
            r.cacheCreateTokens,
            r.durationMs,
            r.costUSD.toFixed(6),
            r.success ? 'true' : 'false',
            r.errorMessage ?? '',
            r.requestSnippet,
          ]
            .map(csvEscape)
            .join(','),
        )
        return [header.join(','), ...rows].join('\n')
      },
    }),
    {
      name: 'lattice.usage',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // `records` is capped to the most recent 500 on disk while the runtime
      // keeps up to 1000 — this keeps localStorage small without sacrificing
      // the in-session scroll buffer. Daily buckets + session aggregates are
      // already small so we persist them verbatim.
      partialize: (state) => ({
        records: state.records.slice(-RECORDS_PERSIST_CAP),
        dailyBuckets: state.dailyBuckets,
        sessionAggregates: state.sessionAggregates,
      }),
    },
  ),
)
