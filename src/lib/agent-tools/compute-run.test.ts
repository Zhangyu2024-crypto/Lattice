// Unit tests for the compute_run tool's summary builder. The tool's
// full `execute()` path depends on the runtime store + runCompute IPC,
// which are heavy to mock for every status case — these tests target
// `buildSummary` directly to lock down the cancelled/failed wording
// that L2 (envelope) and L3 (system prompt) rules anchor on.

import { describe, expect, it } from 'vitest'
import { buildSummary, INTEGRITY_ANCHOR } from './compute-run'

describe('buildSummary — hallucination-defense anchors', () => {
  it('cancelled runs start with "CANCELLED" and include the integrity anchor', () => {
    const s = buildSummary({
      status: 'cancelled',
      exitCode: null,
      figureCount: 0,
      durationMs: 60032,
    })
    expect(s.startsWith('CANCELLED')).toBe(true)
    expect(s).toContain(INTEGRITY_ANCHOR)
    expect(s).toContain('1m 0s')
  })

  it('failed runs start with "FAILED" and include the integrity anchor + exit code', () => {
    const s = buildSummary({
      status: 'failed',
      exitCode: 137,
      figureCount: 0,
      durationMs: 8400,
    })
    expect(s.startsWith('FAILED')).toBe(true)
    expect(s).toContain('(exit=137)')
    expect(s).toContain(INTEGRITY_ANCHOR)
  })

  it('succeeded runs do NOT include the integrity anchor', () => {
    const s = buildSummary({
      status: 'succeeded',
      exitCode: 0,
      figureCount: 1,
      durationMs: 4800,
    })
    expect(s.startsWith('Succeeded')).toBe(true)
    expect(s).not.toContain(INTEGRITY_ANCHOR)
    expect(s).toContain('1 figure')
  })

  it('succeeded runs pluralize figures correctly', () => {
    expect(
      buildSummary({ status: 'succeeded', exitCode: 0, figureCount: 2, durationMs: 1000 }),
    ).toContain('2 figures')
  })

  it('unknown / idle states fall through without the anchor (defensive)', () => {
    // The runner normally blocks until status !== 'running', so this
    // path only trips if the runtime leaves the artifact in a weird
    // transitional state. Behaviour should be non-alarming.
    const s = buildSummary({
      status: 'idle',
      exitCode: null,
      figureCount: 0,
      durationMs: 0,
    })
    expect(s).not.toContain(INTEGRITY_ANCHOR)
    expect(s).toContain('idle')
  })

  it('running runs include the integrity anchor until completion', () => {
    const s = buildSummary({
      status: 'running',
      exitCode: null,
      figureCount: 0,
      durationMs: 125000,
    })
    expect(s.startsWith('RUNNING')).toBe(true)
    expect(s).toContain(INTEGRITY_ANCHOR)
  })
})
