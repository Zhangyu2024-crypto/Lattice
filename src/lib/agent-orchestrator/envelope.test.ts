import { describe, expect, it } from 'vitest'
import { toToolResultBlock } from './envelope'
import type { AgentToolStep } from './types'

function step(output: unknown, opts: Partial<AgentToolStep> = {}): AgentToolStep {
  return {
    toolUseId: 'tu_test',
    name: 'compute_run',
    input: {},
    output,
    isError: false,
    ...opts,
  }
}

describe('toToolResultBlock integrity warning', () => {
  it('wraps cancelled compute result in a warning envelope', () => {
    const result = toToolResultBlock(
      step({
        artifactId: 'art_1',
        status: 'cancelled',
        cancelled: true,
        exitCode: null,
        durationMs: 60032,
        stdoutTail: '[run] s=0.94 ...\n',
        figureCount: 0,
        summary: 'CANCELLED after 60s — run did not complete. Do NOT present derived results.',
      }),
    )
    expect(result.type).toBe('tool_result')
    const content = String(result.content)
    expect(content.startsWith('⚠️ INTEGRITY WARNING')).toBe(true)
    expect(content).toContain('status=cancelled')
    expect(content).toContain('Do NOT fabricate')
    // Structured payload is still present after the warning so the
    // model can still see the actual fields.
    expect(content).toContain('"artifactId":"art_1"')
    expect(content).toContain('"status":"cancelled"')
  })

  it('wraps failed compute result in a warning envelope', () => {
    const result = toToolResultBlock(
      step({
        artifactId: 'art_1',
        status: 'failed',
        cancelled: false,
        exitCode: 137,
        durationMs: 8400,
        stdoutTail: '',
        figureCount: 0,
        summary: 'FAILED (exit=137) in 8.40 s. Do NOT present derived results.',
      }),
    )
    expect(String(result.content).startsWith('⚠️ INTEGRITY WARNING')).toBe(true)
    expect(String(result.content)).toContain('status=failed')
  })

  it('passes a succeeded compute result through unchanged', () => {
    const result = toToolResultBlock(
      step({
        artifactId: 'art_1',
        status: 'succeeded',
        cancelled: false,
        exitCode: 0,
        durationMs: 4800,
        stdoutTail: 'B0 = 88.8 GPa',
        figureCount: 1,
        summary: 'Succeeded (exit=0) in 4.80 s, 1 figure.',
      }),
    )
    const content = String(result.content)
    expect(content.startsWith('⚠️')).toBe(false)
    expect(content).toContain('"status":"succeeded"')
  })

  it('wraps running compute result in a warning envelope', () => {
    const result = toToolResultBlock(
      step({
        artifactId: 'art_1',
        status: 'running',
        cancelled: false,
        background: true,
        exitCode: null,
        durationMs: 125000,
        stdoutTail: 'SCF iteration 23',
        figureCount: 0,
        summary: 'RUNNING in 2m 5s — compute process is still in progress. Do NOT present derived results until status=succeeded.',
      }),
    )
    const content = String(result.content)
    expect(content.startsWith('⚠️ INTEGRITY WARNING')).toBe(true)
    expect(content).toContain('status=running')
    expect(content).toContain('still in progress')
  })

  it('wraps partial compute experiment result in a warning envelope', () => {
    const result = toToolResultBlock(
      step({
        artifactId: 'exp_1',
        status: 'partial',
        pointCount: 6,
        succeeded: 4,
        failed: 2,
        summary: 'partial: 4/6 points succeeded',
      }, { name: 'compute_experiment_run' }),
    )
    const content = String(result.content)
    expect(content.startsWith('⚠️ INTEGRITY WARNING')).toBe(true)
    expect(content).toContain('partially complete')
  })

  it('does not warn on non-compute tool outputs with a failed status', () => {
    const result = toToolResultBlock(
      step({ status: 'failed', reason: 'not a compute run' }, { name: 'some_other_tool' }),
    )
    expect(String(result.content).startsWith('⚠️')).toBe(false)
  })

  it('does not warn on non-compute tool outputs (no status field)', () => {
    const result = toToolResultBlock(
      step({ peaks: [{ twoTheta: 27.3, intensity: 1.0 }] }, { name: 'detect_peaks' }),
    )
    expect(String(result.content).startsWith('⚠️')).toBe(false)
  })

  it('does not warn on string / primitive outputs', () => {
    expect(String(toToolResultBlock(step('ok')).content).startsWith('⚠️')).toBe(false)
    expect(String(toToolResultBlock(step(42)).content).startsWith('⚠️')).toBe(false)
    expect(String(toToolResultBlock(step(null)).content).startsWith('⚠️')).toBe(false)
  })

  it('does not double-warn when isError is set (explicit tool error path)', () => {
    // When a tool throws, `isError: true` and the output is wrapped in
    // `{ error: ... }` — the existing error path is enough, we
    // intentionally skip the integrity-warning prefix.
    const result = toToolResultBlock(
      step(
        { status: 'cancelled' },
        { isError: true },
      ),
    )
    expect(String(result.content).startsWith('⚠️')).toBe(false)
    expect(String(result.content)).toContain('"error":')
  })
})
